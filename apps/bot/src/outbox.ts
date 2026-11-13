// The delivery feed and rank-ups. The API writes OutboxEvent rows
// (packages/api/src/outbox.ts); this reads the unprocessed ones, oldest first,
// posts them and marks them processed.
//
// What happens when things go wrong
// ---------------------------------
// Three columns on the row carry the state: `attempts`, `lastError`,
// `nextAttemptAt`. Before anything is sent the bot "claims" the row:
// attempts + 1, lastError cleared, nextAttemptAt two minutes ahead.
//
// - Sent: `processedAt` is set.
// - Not configured (no server, no channel), the server check fails, the bot
//   lacks a permission, the payload is unknown: `processedAt` is set and
//   `lastError` says why. Nothing is posted later; there is no backlog to
//   flood a channel once the setup is fixed.
// - Discord is down or rate-limiting (nothing was sent): `lastError` is set
//   and the row waits (15 s, 1 min, 5 min, 15 min, 1 h). After 6 tries it is
//   marked processed with "Gave up after 6 tries". Rows behind it are not held
//   up: a waiting row is skipped until its time comes.
// - The bot stopped between sending and marking, or Discord never answered:
//   the row is left claimed (attempts > 0, lastError null). Nobody can know
//   whether the message went out. Two minutes later it gets one last try, and
//   for that one the row is marked processed BEFORE sending. So a message can
//   appear twice, never three times, and such a row can never stick.
//
// A row is one of: new (attempts 0) / waiting (lastError set) / claimed or
// interrupted (attempts > 0, lastError null) / processed.
import { OutboxPayloadSchema, type OutboxPayload } from "@te-rebrand/api/outbox";

import type { Access } from "./access";
import { DiscordError, describeError, type Discord, type OutgoingMessage } from "./discord";
import { dedupeKey } from "./ledger";
import type { Logger } from "./log";
import { deliveryMessage, rankUpMessage } from "./messages";
import { changeRankRoles } from "./roles";
import type { CompanyRow, OutboxRow, Store } from "./store";

export const MAX_ATTEMPTS = 6;
/** Wait after the 1st, 2nd, ... failed try. */
export const RETRY_WAITS_MS = [15_000, 60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];
/** How long a claim hides a row. A try takes seconds; this only matters after a crash. */
export const CLAIM_MS = 2 * 60_000;
/** A delivery the bot only gets to after this long is not news any more. */
export const STALE_DELIVERY_MS = 24 * 60 * 60_000;

export const INTERRUPTED_NOTE =
  "An earlier try was cut off, so it is unknown whether it posted. Tried once more.";

/** The message may or may not have been sent: do not write an outcome. */
class Unknowable extends Error {}

type Deps = { store: Store; discord: Discord; access: Access; now: () => Date; log: Logger };

export class Outbox {
  constructor(private readonly deps: Deps) {}

  /** Handles up to `limit` rows. Returns how many it took on. */
  async tick(limit = 20): Promise<number> {
    const { store, now, log } = this.deps;
    const rows = await store.pendingOutbox(now(), limit);
    let handled = 0;
    for (const row of rows) {
      const interrupted = row.attempts > 0 && row.lastError === null;
      if (interrupted) {
        if (!(await store.claimOutboxForLastTry(row, now(), INTERRUPTED_NOTE))) continue;
        handled++;
        let outcome: string | null;
        try {
          outcome = await this.handle(row, true);
        } catch (error) {
          outcome = `It failed: ${describeError(error)}`;
        }
        if (outcome) await store.noteOutbox(row.id, `${INTERRUPTED_NOTE} ${outcome}`);
        log.warn(`outbox ${row.id} (${row.type}): last try after an interrupted one`);
        continue;
      }

      if (!(await store.claimOutbox(row, new Date(now().getTime() + CLAIM_MS)))) continue;
      handled++;
      const attempt = row.attempts + 1;
      let note: string | null;
      try {
        // `handle` sends as its very last step, so an error from it means
        // nothing was sent (or, for Unknowable, that nobody can tell).
        note = await this.handle(row, attempt >= MAX_ATTEMPTS);
      } catch (error) {
        if (error instanceof Unknowable) {
          log.warn(`outbox ${row.id} (${row.type}): ${error.message}; one more try later`);
          continue;
        }
        const why = describeError(error);
        if (error instanceof DiscordError && !error.passes) {
          // Discord said no for good (the bot was removed from the server, say).
          await store.finishOutbox(row.id, now(), `Not done: ${why}`);
          log.warn(`outbox ${row.id} (${row.type}): not done: ${why}`);
        } else if (attempt >= MAX_ATTEMPTS) {
          await store.finishOutbox(row.id, now(), `Gave up after ${attempt} tries: ${why}`);
          log.error(`outbox ${row.id} (${row.type}): gave up after ${attempt} tries: ${why}`);
        } else {
          const wait = RETRY_WAITS_MS[attempt - 1] ?? RETRY_WAITS_MS.at(-1)!;
          await store.retryOutbox(row.id, why, new Date(now().getTime() + wait));
          log.warn(`outbox ${row.id} (${row.type}): try ${attempt} failed: ${why}`);
        }
        continue;
      }
      // Outside the try on purpose: if this write fails after a message went
      // out, the row must stay "claimed" (one last try), not count as a
      // failed send that gets five more.
      await store.finishOutbox(row.id, now(), note);
      if (note) log.info(`outbox ${row.id} (${row.type}): ${note}`);
    }
    return handled;
  }

  /**
   * Does what the row asks. Returns null when all went well, or a note for
   * `lastError` when it was skipped or only partly done. Throws when nothing
   * was sent and it is worth trying again.
   */
  private async handle(row: OutboxRow, lastTry: boolean): Promise<string | null> {
    const parsed = OutboxPayloadSchema.safeParse(row.payload);
    if (!parsed.success) return `Skipped: the bot does not know this kind of event (${row.type}).`;
    const company = await this.deps.store.company(row.companyId);
    if (!company) return "Skipped: the company no longer exists.";
    if (!company.discordGuildId) return "Skipped: the company has no Discord server set.";

    return parsed.data.type === "job_delivered"
      ? this.delivery(row, company, parsed.data)
      : this.rankUp(row, company, parsed.data, lastTry);
  }

  private async delivery(
    row: OutboxRow,
    company: CompanyRow,
    job: Extract<OutboxPayload, { type: "job_delivered" }>,
  ) {
    const channelId = company.discord.deliveryChannelId;
    if (!channelId) return "Skipped: no delivery channel is set.";
    if (this.deps.now().getTime() - row.createdAt.getTime() > STALE_DELIVERY_MS) {
      return "Skipped: more than 24 hours old by the time the bot got to it.";
    }
    const access = await this.deps.access.channel(company, channelId);
    if (!access.ok) return `Skipped: ${access.reason}`;
    return this.send(row, company, channelId, deliveryMessage(job));
  }

  private async rankUp(
    row: OutboxRow,
    company: CompanyRow,
    rankUp: Extract<OutboxPayload, { type: "rank_up" }>,
    lastTry: boolean,
  ) {
    const { store, discord, access, now } = this.deps;
    const server = await access.server(company);
    if (!server.ok) return `Skipped: ${server.reason}`;

    const notes: string[] = [];
    const wantsRoles = Boolean(rankUp.discordRoleId || rankUp.previousDiscordRoleId);
    const channelId = company.discord.rankUpChannelId;
    if (!wantsRoles && !channelId) return "Skipped: no rank-up channel is set.";

    // Is the driver in the server? Decides both the roles and the ping.
    const userId = await store.driverDiscordId(rankUp.driverId);
    const isMember = userId
      ? (await discord.memberPermissions(server.guildId, userId)) !== null
      : false;

    if (wantsRoles) {
      if (!userId || !isMember) {
        notes.push(
          userId
            ? `${rankUp.driverName} is not in the Discord server, so no role was changed.`
            : `${rankUp.driverName} has no Discord account linked, so no role was changed.`,
        );
      } else {
        // Roles first: giving a role twice does no harm, so a retry is safe.
        const problems = await changeRankRoles(
          { discord, store },
          company,
          server.guildId,
          {
            userId,
            driverName: rankUp.driverName,
            rankName: rankUp.rankName,
            give: rankUp.discordRoleId,
            take: rankUp.previousDiscordRoleId,
          },
          // On the last try, post the rank-up even if Discord still will not change roles.
          { keepGoing: lastTry },
        );
        for (const problem of problems) await store.recordProblem(company.id, problem, now());
        notes.push(...problems);
      }
    }

    if (!channelId) {
      notes.push("No rank-up channel is set, so nothing was posted.");
    } else {
      const channel = await access.channel(company, channelId);
      const note = channel.ok
        ? await this.send(
            row,
            company,
            channelId,
            rankUpMessage(rankUp, company.name, isMember ? userId : null),
          )
        : `Not posted: ${channel.reason}`;
      if (note) notes.push(note);
    }
    return notes.length > 0 ? notes.join(" ") : null;
  }

  /** Null when sent, a note when Discord refused for good. Throws when it is worth another try. */
  private async send(
    row: OutboxRow,
    company: CompanyRow,
    channelId: string,
    message: OutgoingMessage,
  ): Promise<string | null> {
    try {
      await this.deps.discord.sendMessage(channelId, {
        ...message,
        dedupeKey: dedupeKey("outbox", row.id),
      });
      return null;
    } catch (error) {
      if (!(error instanceof DiscordError)) throw new Unknowable(describeError(error));
      if (error.kind === "no_answer") throw new Unknowable(error.message);
      if (error.passes) throw error;
      await this.deps.store.recordProblem(company.id, error.message, this.deps.now());
      return `Not posted: ${error.message}`;
    }
  }
}
