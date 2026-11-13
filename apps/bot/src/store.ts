// Everything the bot asks of the database. The Prisma version is in
// prisma-store.ts; tests use the in-memory one in test/fakes.ts.
import type { CompanySettings } from "@te-rebrand/api/company-settings";
import type { OutboxPayload } from "@te-rebrand/api/outbox";

export type CompanyRow = {
  id: string;
  name: string;
  /** What a manager typed in. Not trusted until access.ts has checked it. */
  discordGuildId: string | null;
  truckersmpVtcId: number | null;
  /** The TruckersMP VTC is confirmed to be theirs (Company.verifiedAt). */
  verified: boolean;
  discord: CompanySettings["discord"];
};

export type OutboxRow = {
  id: string;
  companyId: string;
  type: string;
  payload: unknown;
  createdAt: Date;
  attempts: number;
  lastError: string | null;
};

export type MonthlyDriver = {
  driverId: string;
  driverName: string;
  /** Delivered distance that month, km. */
  km: number;
  /** The part of `km` driven in ATS, to decide whether to show miles. */
  atsKm: number;
  jobs: number;
};

/** pending: claimed, outcome not written. unknown: sent but Discord never answered. */
export type PostStatus = "pending" | "posted" | "failed" | "skipped" | "unknown";
export type PostState = { companyId: string; key: string; status: PostStatus; updatedAt: Date };

/** The outbox type that asks for a member's rank roles to be put right. */
export const ROLE_SYNC = "rank_roles_sync" satisfies OutboxPayload["type"];
/**
 * The outbox is read in two lanes, each by its own loop: "roles" is the role
 * syncs, "posts" is everything else. A ladder change in a big company writes
 * a sync per member; in a lane of their own they cannot hold up the delivery feed.
 */
export type OutboxLane = "posts" | "roles";

/** Where a driver stands in a company right now, for a role sync. */
export type RankRoleTarget = {
  /** An active member. Anyone else holds no rank role. */
  active: boolean;
  /** The rank they hold, if any. */
  rankName: string | null;
  /** That rank's Discord role, if it has one. */
  roleId: string | null;
};

export interface Store {
  // ---- outbox (see outbox.ts for the rules) ----
  /** Unprocessed rows of a lane whose `nextAttemptAt` has passed or was never set, oldest first. */
  pendingOutbox(now: Date, limit: number, lane: OutboxLane): Promise<OutboxRow[]>;
  /**
   * Starts a try: attempts + 1, lastError cleared, hidden from other readers
   * until `until`. False if someone else got to the row first.
   */
  claimOutbox(row: Pick<OutboxRow, "id" | "attempts">, until: Date): Promise<boolean>;
  /** Starts the last try of a row: marks it processed before anything is sent. */
  claimOutboxForLastTry(
    row: Pick<OutboxRow, "id" | "attempts">,
    now: Date,
    note: string,
  ): Promise<boolean>;
  /** Done. `note` says why it was skipped or what went wrong, null when all went well. */
  finishOutbox(id: string, now: Date, note: string | null): Promise<void>;
  /** A try that certainly did nothing: keep the row for another go at `nextAttemptAt`. */
  retryOutbox(id: string, error: string, nextAttemptAt: Date): Promise<void>;
  /** Changes the note on a row that is already processed. */
  noteOutbox(id: string, note: string): Promise<void>;

  // ---- companies ----
  company(id: string): Promise<CompanyRow | null>;
  /** Companies with a Discord server id set. */
  companiesWithDiscord(): Promise<CompanyRow[]>;
  /** Discord user ids of the company's active owners and managers, owners first. */
  managerDiscordIds(companyId: string): Promise<string[]>;
  driverDiscordId(driverId: string): Promise<string | null>;
  /** Every `Rank.discordRoleId` of the company: the only roles the bot may touch for it. */
  rankRoleIds(companyId: string): Promise<string[]>;
  /** The driver's membership and rank in the company as they are now (ranks.ts in the API). */
  rankRoleTarget(companyId: string, driverId: string): Promise<RankRoleTarget>;
  /** Drivers by delivered distance with `from <= finishedAt < to`, furthest first. */
  monthlyTop(companyId: string, from: Date, to: Date, limit: number): Promise<MonthlyDriver[]>;

  // ---- scheduled posts (see ledger.ts) ----
  findPosts(filter: { kind: string; keys: string[]; companyId?: string }): Promise<PostState[]>;
  /**
   * Takes the right to send this post: true for exactly one caller. A post
   * that failed before `retryFailedBefore` can be taken again.
   */
  claimPost(
    companyId: string,
    kind: string,
    key: string,
    retryFailedBefore: Date,
  ): Promise<boolean>;
  settlePost(
    companyId: string,
    kind: string,
    key: string,
    status: Exclude<PostStatus, "pending">,
    detail: string | null,
  ): Promise<void>;
  /** Removes rows of that kind created before `before`. Returns how many. */
  prunePosts(kind: string, before: Date): Promise<number>;

  // ---- what the settings screen can show ----
  saveGuildCheck(
    companyId: string,
    check: { guildId: string; ok: boolean; reason: string | null },
    now: Date,
  ): Promise<void>;
  recordProblem(companyId: string, problem: string, now: Date): Promise<void>;
}
