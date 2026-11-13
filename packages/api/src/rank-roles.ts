// Keeping Discord rank roles right when something other than a delivery
// changes them. A delivery that crosses a threshold writes `rank_up`
// (deliveries.ts). Everything else writes `rank_roles_sync`, one row per member
// whose roles may now be wrong, in the same transaction as the change:
//
//   - someone joins (application accepted, company registered)
//   - someone leaves, is removed, or is set inactive by the nightly check
//   - a rank is added, edited or deleted
//   - the company points the bot at another Discord server
//
// The row only says "look at this member". The bot works out the roles from
// the database when it handles the row (apps/bot/src/outbox.ts).
//
// Kept small for big companies: a change to the ladder writes a row only for
// the members whose role it actually moves (compared before and after), none
// at all while no rank has a role, and the rows go in as one INSERT per 1000.
import type { Database } from "@te-rebrand/db";

import { enqueueOutbox, type OutboxPayload, type RoleSyncReason } from "./outbox";
import { companyRanks, memberDistances, rankAt } from "./ranks";

/** What the callback of `db.$transaction` gets. */
export type Tx = Parameters<Parameters<Database["$transaction"]>[0]>[0];

type LadderRank = { minKm: number; discordRoleId: string | null };

const INSERT_ROWS = 1000;
/** As many as the payload schema takes; a ladder never has this many roles to retire at once. */
const MAX_RETIRED = 50;

/** One member. Call it in the transaction that changed their membership. */
export async function requestRoleSync(
  tx: Pick<Tx, "outboxEvent" | "driver">,
  input: { companyId: string; driverId: string; reason: RoleSyncReason },
) {
  const driver = await tx.driver.findUniqueOrThrow({
    where: { id: input.driverId },
    select: { displayName: true },
  });
  await enqueueOutbox(tx, input.companyId, {
    type: "rank_roles_sync",
    driverId: input.driverId,
    driverName: driver.displayName,
    reason: input.reason,
    retiredRoleIds: [],
  });
}

async function requestRoleSyncs(
  tx: Pick<Tx, "outboxEvent">,
  companyId: string,
  members: { driverId: string; displayName: string }[],
  reason: RoleSyncReason,
  retiredRoleIds: string[],
) {
  for (let i = 0; i < members.length; i += INSERT_ROWS) {
    await tx.outboxEvent.createMany({
      data: members.slice(i, i + INSERT_ROWS).map((m) => ({
        companyId,
        type: "rank_roles_sync",
        payload: {
          type: "rank_roles_sync",
          driverId: m.driverId,
          driverName: m.displayName,
          reason,
          retiredRoleIds,
        } satisfies OutboxPayload,
      })),
    });
  }
  return members.length;
}

const rolesOf = (ranks: readonly LadderRank[]) =>
  new Set(ranks.flatMap((r) => (r.discordRoleId ? [r.discordRoleId] : [])));

/** Only distances and roles decide who holds which role; a new name moves nobody. */
const shape = (ranks: readonly LadderRank[]) =>
  JSON.stringify(
    [...ranks].sort((a, b) => a.minKm - b.minKm).map((r) => [r.minKm, r.discordRoleId]),
  );

/**
 * Runs a change to a company's ranks and, in the same transaction, asks for a
 * sync of every active member the change moves to another role. Returns what
 * `change` returns.
 *
 * Ladder changes of one company run one at a time (a lock on the company row),
 * so the ladder read before and after is the one this change made.
 */
export function changeRanks<T>(
  db: Database,
  companyId: string,
  change: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM company WHERE id = ${companyId} FOR UPDATE`;
    const before = await companyRanks(tx, companyId);
    const result = await change(tx);
    const after = await companyRanks(tx, companyId);

    const [rolesBefore, rolesAfter] = [rolesOf(before), rolesOf(after)];
    if (rolesBefore.size === 0 && rolesAfter.size === 0) return result;
    if (shape(before) === shape(after)) return result;

    const roleAt = (ranks: readonly LadderRank[], km: number) =>
      rankAt(ranks, km).current?.discordRoleId ?? null;
    const moved = (await memberDistances(tx, companyId)).filter(
      (m) => roleAt(before, m.km) !== roleAt(after, m.km),
    );
    const retired = [...rolesBefore].filter((role) => !rolesAfter.has(role)).slice(0, MAX_RETIRED);
    await requestRoleSyncs(tx, companyId, moved, "ranks_changed", retired);
    return result;
  });
}

/**
 * Every active member, for when the company's Discord server changes: nobody
 * has a rank role in the new one yet. Nothing while no rank has a role.
 * Returns how many rows were written.
 */
export async function requestRoleSyncForAll(
  tx: Pick<Tx, "outboxEvent" | "rank" | "membership" | "job">,
  companyId: string,
  reason: RoleSyncReason,
) {
  if (rolesOf(await companyRanks(tx, companyId)).size === 0) return 0;
  return requestRoleSyncs(tx, companyId, await memberDistances(tx, companyId), reason, []);
}
