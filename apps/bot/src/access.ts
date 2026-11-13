// May the bot act in the server a company names? `Company.discordGuildId` is
// whatever a manager typed in, and the bot is in many servers: a manager could
// enter the id of another VTC's server. So before the bot posts or changes
// roles for a company, it checks two things:
//
//   1. At least one active owner or manager of the company (by their Discord
//      account) has the Manage Server permission in that server. Whoever has
//      that permission could have invited the bot there themselves.
//   2. Each channel it is about to post in belongs to that same server.
//
// Answers are remembered for a few minutes (less for a "no", so a manager who
// just fixed their setup does not wait long). A "no" is saved in BotStatus,
// where the settings screen can show it.
import { DiscordError, type Discord } from "./discord";
import type { CompanyRow, Store } from "./store";

export type ServerAccess =
  | { ok: true; guildId: string }
  /** `configured` false: the company has not set a server at all. */
  | { ok: false; reason: string; configured: boolean };

/** How many owners and managers to look up at most, owners first. */
const MAX_MANAGERS_CHECKED = 25;

type Remembered<T> = { until: number; value: T };

export class Access {
  private readonly servers = new Map<string, Remembered<ServerAccess>>();
  private readonly channels = new Map<string, Remembered<string | null>>();

  constructor(
    private readonly deps: {
      discord: Discord;
      store: Store;
      now: () => Date;
      /** How long a "yes" is remembered. */
      okTtlMs?: number;
      /** How long a "no" is remembered. */
      failTtlMs?: number;
    },
  ) {}

  private remember<T>(cache: Map<string, Remembered<T>>, key: string, value: T, ok: boolean) {
    const ttl = ok ? (this.deps.okTtlMs ?? 5 * 60_000) : (this.deps.failTtlMs ?? 60_000);
    cache.set(key, { until: this.deps.now().getTime() + ttl, value });
    // Forget what has run out, so the maps do not grow with every id ever seen.
    if (cache.size > 5000) {
      const now = this.deps.now().getTime();
      for (const [k, v] of cache) if (v.until <= now) cache.delete(k);
    }
    return value;
  }

  private recall<T>(cache: Map<string, Remembered<T>>, key: string) {
    const hit = cache.get(key);
    return hit && hit.until > this.deps.now().getTime() ? hit : undefined;
  }

  /**
   * Check 1. Throws a DiscordError that passes (`error.passes`) when Discord
   * could not be asked; nothing is remembered then.
   */
  async server(company: CompanyRow): Promise<ServerAccess> {
    const guildId = company.discordGuildId;
    if (!guildId) return { ok: false, reason: "No Discord server is set.", configured: false };

    // The server id is part of the key: a changed id is checked at once.
    const key = `${company.id}:${guildId}`;
    const hit = this.recall(this.servers, key);
    if (hit) return hit.value;

    const reason = await this.whyNot(company, guildId);
    await this.deps.store.saveGuildCheck(
      company.id,
      { guildId, ok: reason === null, reason },
      this.deps.now(),
    );
    const answer: ServerAccess =
      reason === null ? { ok: true, guildId } : { ok: false, reason, configured: true };
    return this.remember(this.servers, key, answer, answer.ok);
  }

  private async whyNot(company: CompanyRow, guildId: string): Promise<string | null> {
    const managers = await this.deps.store.managerDiscordIds(company.id);
    if (managers.length === 0) {
      return `No owner or manager of ${company.name} has a Discord account linked.`;
    }
    for (const userId of managers.slice(0, MAX_MANAGERS_CHECKED)) {
      try {
        const member = await this.deps.discord.memberPermissions(guildId, userId);
        if (member?.manageServer) return null;
      } catch (error) {
        if (!(error instanceof DiscordError) || error.passes) throw error;
        if (error.kind === "bot_not_in_server") {
          return `The bot is not in the Discord server ${guildId}. Invite it there first.`;
        }
        // Anything else about this one person (an id Discord does not know): try the next.
      }
    }
    return `No owner or manager of ${company.name} has the Manage Server permission in the Discord server ${guildId}.`;
  }

  /**
   * Checks 1 and 2 for one channel. A channel in another server, or one the
   * bot cannot see, is a "no" with the reason saved as the company's last problem.
   */
  async channel(company: CompanyRow, channelId: string): Promise<ServerAccess> {
    const server = await this.server(company);
    if (!server.ok) return server;

    const key = `${company.id}:${server.guildId}:${channelId}`;
    let problem = this.recall(this.channels, key)?.value;
    if (problem === undefined) {
      const actual = await this.deps.discord.channelGuildId(channelId);
      problem =
        actual === server.guildId
          ? null
          : actual === null
            ? `Channel ${channelId} does not exist or the bot cannot see it.`
            : `Channel ${channelId} is not in the Discord server ${server.guildId}.`;
      this.remember(this.channels, key, problem, problem === null);
      if (problem) await this.deps.store.recordProblem(company.id, problem, this.deps.now());
    }
    return problem === null ? server : { ok: false, reason: problem, configured: true };
  }
}
