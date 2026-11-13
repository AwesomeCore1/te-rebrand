// Puts the pieces together: what runs, and how often. No Discord or database
// library is named here, so tests start the whole bot on fakes.
import { Access } from "./access";
import { postConvoyReminders, type ConvoyDeps } from "./convoys";
import type { Discord } from "./discord";
import type { Logger } from "./log";
import { every } from "./loops";
import { postMonthlyWinners } from "./monthly";
import { Outbox } from "./outbox";
import type { Store } from "./store";

export const OUTBOX_EVERY_MS = 3_000;
/** Role syncs handled per round. Each is a member lookup and at most a few role changes. */
export const ROLE_SYNC_BATCH = 10;
/** Monthly winners and convoy reminders are looked at this often. */
export const SCHEDULE_EVERY_MS = 5 * 60_000;

export type BotDeps = {
  store: Store;
  discord: Discord;
  log: Logger;
  now?: () => Date;
  upcomingConvoys?: ConvoyDeps["upcomingConvoys"];
};

/** One pass over each job, for tests and for `startBot`. */
export function createBot({ store, discord, log, now = () => new Date(), ...rest }: BotDeps) {
  const access = new Access({ discord, store, now });
  const deps = { store, discord, access, now, log };
  const outbox = new Outbox(deps);
  return {
    outbox: () => outbox.tick(),
    roleSync: () => outbox.tick(ROLE_SYNC_BATCH, "roles"),
    monthly: () => postMonthlyWinners(deps),
    convoys: () => postConvoyReminders({ ...deps, upcomingConvoys: rest.upcomingConvoys }),
  };
}

export function startBot(deps: BotDeps) {
  const bot = createBot(deps);
  const loops = [
    every("delivery feed and rank-ups", OUTBOX_EVERY_MS, bot.outbox, deps.log),
    // Its own loop, so a few hundred syncs after a ladder change never delay a post.
    every("rank role sync", OUTBOX_EVERY_MS, bot.roleSync, deps.log),
    every("monthly winners", SCHEDULE_EVERY_MS, bot.monthly, deps.log),
    every("convoy reminders", SCHEDULE_EVERY_MS, bot.convoys, deps.log),
  ];
  return { stop: () => Promise.all(loops.map((l) => l.stop())) };
}
