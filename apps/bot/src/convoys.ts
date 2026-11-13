// Convoy reminders. Convoys live on TruckersMP and are read from there each
// time (docs/PLAN.md: never stored by us). The only thing kept is one BotPost
// row per reminder sent, so it is not sent again.
//
// Two reminders per convoy, counted from the meet-up time:
//   - "day":  when the meet-up is 24 hours away or less (but more than 3 hours:
//             a convoy announced on short notice gets only the second one);
//   - "hour": when the meet-up is an hour away or less.
// The bot looks every few minutes, so a reminder goes out within minutes of
// its moment. If the organiser moves the meet-up, the reminders for the new
// time are sent again: the time is part of the key.
import { hostedEvents, type TmpEvent } from "@te-rebrand/truckersmp";

import type { Access } from "./access";
import { isOpen, sendOnce, setAside, type LedgerDeps } from "./ledger";
import { convoyReminderMessage, type ReminderWhen } from "./messages";

export const CONVOY_KIND = "convoy_reminder";
const HOUR = 60 * 60_000;
/** A reminder that failed is tried again after this, while it is still due. */
const RETRY_AFTER_MS = 15 * 60_000;
/** Rows for convoys long past are of no use. */
const KEEP_MS = 45 * 24 * HOUR;

/** Which reminder a convoy is due for at `now`, if any. */
export function reminderDue(event: Pick<TmpEvent, "meetupAt">, now: Date): ReminderWhen | null {
  const until = event.meetupAt.getTime() - now.getTime();
  if (until <= 0) return null;
  if (until <= HOUR) return "hour";
  if (until > 3 * HOUR && until <= 24 * HOUR) return "day";
  return null;
}

export const reminderKey = (event: Pick<TmpEvent, "id" | "meetupAt">, when: ReminderWhen) =>
  `${event.id}:${when}:${event.meetupAt.toISOString()}`;

export type ConvoyDeps = LedgerDeps & {
  access: Access;
  /** Upcoming convoys a VTC hosts. Defaults to TruckersMP (cached for 10 minutes there). */
  upcomingConvoys?: (vtcId: number) => Promise<TmpEvent[]>;
};

export async function postConvoyReminders(deps: ConvoyDeps) {
  const { store, access, now, log } = deps;
  const upcoming = deps.upcomingConvoys ?? ((vtcId: number) => hostedEvents(vtcId));

  // Same rule as the website (packages/api/src/convoys.ts): only a VTC that is
  // verified as theirs, so nobody borrows another VTC's convoys.
  const companies = (await store.companiesWithDiscord()).filter(
    (c) => c.truckersmpVtcId !== null && c.verified && c.discord.eventChannelId,
  );

  for (const company of companies) {
    try {
      const events = await upcoming(company.truckersmpVtcId!);
      const due = events.flatMap((event) => {
        const when = reminderDue(event, now());
        return when ? [{ event, when, key: reminderKey(event, when) }] : [];
      });
      if (due.length === 0) continue;

      const states = new Map(
        (
          await store.findPosts({
            kind: CONVOY_KIND,
            keys: due.map((d) => d.key),
            companyId: company.id,
          })
        ).map((s) => [s.key, s]),
      );
      const channelId = company.discord.eventChannelId!;
      for (const { event, when, key } of due) {
        if (!isOpen(states.get(key), now(), RETRY_AFTER_MS)) continue;
        const post = {
          companyId: company.id,
          kind: CONVOY_KIND,
          key,
          retryAfterMs: RETRY_AFTER_MS,
        };
        const target = await access.channel(company, channelId);
        if (!target.ok) {
          await setAside(deps, post, "failed", target.reason);
          continue;
        }
        const result = await sendOnce(deps, post, channelId, convoyReminderMessage(event, when));
        if (result === "posted") {
          log.info(`convoy reminder (${when}) for "${event.name}" posted for ${company.name}`);
        }
      }
    } catch (error) {
      // TruckersMP down, or Discord: this company waits for the next round.
      log.warn(`convoy reminders for ${company.name}: ${String(error)}`);
    }
  }

  await store.prunePosts(CONVOY_KIND, new Date(now().getTime() - KEEP_MS));
}
