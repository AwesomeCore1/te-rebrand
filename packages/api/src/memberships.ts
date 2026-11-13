// Joining, leaving and being removed from a company. A driver has at most one
// active company at a time (TruckersMP allows one VTC per player), and rows are
// never deleted: history is kept when someone leaves (docs/PLAN.md).
import type { Database } from "@te-rebrand/db";
import { player, TruckersMpError } from "@te-rebrand/truckersmp";
import { TRPCError } from "@trpc/server";

import { leaveBlock, removalBlock, type Role } from "./membership-rules";

/** The database, or a transaction on it. */
export type Tx = Omit<Database, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;

/**
 * Locks the driver's row until the transaction ends. Everything that could
 * give a driver an active membership takes this lock first, so two requests at
 * once can't both find "no company yet" and put the driver in two companies.
 */
export async function lockDriver(tx: Tx, driverId: string) {
  await tx.$queryRaw`SELECT id FROM driver WHERE id = ${driverId} FOR UPDATE`;
}

/** The driver's one active membership, if any. */
export function activeMembership(tx: Tx, driverId: string) {
  return tx.membership.findFirst({
    where: { driverId, status: "active" },
    include: { company: { select: { id: true, name: true, slug: true } } },
  });
}

/**
 * Makes the driver an active member. Run inside a transaction. Throws CONFLICT
 * when the driver already has an active company; `conflictMessage` words that
 * for whoever is asking (the driver themselves, or a manager about someone else).
 */
export async function joinCompany(
  tx: Tx,
  input: { companyId: string; driverId: string; role: Role; now: Date; checkedVtc?: boolean },
  conflictMessage: (companyName: string) => string,
) {
  await lockDriver(tx, input.driverId);
  const current = await activeMembership(tx, input.driverId);
  if (current) {
    throw new TRPCError({ code: "CONFLICT", message: conflictMessage(current.company.name) });
  }
  return tx.membership.create({
    data: {
      companyId: input.companyId,
      driverId: input.driverId,
      role: input.role,
      status: "active",
      joinedAt: input.now,
      lastVtcCheckAt: input.checkedVtc ? input.now : null,
    },
  });
}

/** A manager or owner takes a member out of the company. */
export async function removeMember(
  db: Database,
  input: {
    companyId: string;
    membershipId: string;
    actor: { membershipId: string; role: Role };
    now?: Date;
  },
) {
  // Scoped by companyId: a membership id from another company is "not found".
  const target = await db.membership.findFirst({
    where: { id: input.membershipId, companyId: input.companyId, status: "active" },
    select: { id: true, role: true },
  });
  if (!target) throw new TRPCError({ code: "NOT_FOUND", message: "That member isn't here." });
  const block = removalBlock(input.actor.role, target.role, target.id === input.actor.membershipId);
  if (block) throw new TRPCError({ code: "FORBIDDEN", message: block });
  const { count } = await db.membership.updateMany({
    // The role is checked again in the write, in case it changed in between.
    where: { id: target.id, companyId: input.companyId, status: "active", role: target.role },
    data: { status: "removed", leftAt: input.now ?? new Date() },
  });
  if (count === 0) throw new TRPCError({ code: "NOT_FOUND", message: "That member isn't here." });
}

/** A member leaves their own company. */
export async function leaveCompany(
  db: Database,
  membership: { id: string; role: Role },
  now = new Date(),
) {
  const block = leaveBlock(membership.role);
  if (block) throw new TRPCError({ code: "FORBIDDEN", message: block });
  const { count } = await db.membership.updateMany({
    where: { id: membership.id, status: "active", role: { not: "owner" } },
    data: { status: "left", leftAt: now },
  });
  if (count === 0) throw new TRPCError({ code: "NOT_FOUND", message: "You're not in a company." });
}

/** True for Prisma's "unique constraint failed". */
export function isUniqueViolation(e: unknown) {
  return typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";
}

/**
 * Remembers the driver's TruckersMP id once we've seen their player there
 * (null when their Steam account has none). Call it outside a transaction: it
 * never fails the request it runs in. The id is a convenience; the SteamID64 is
 * what people are looked up by.
 */
export async function rememberTruckersmpId(
  db: Database,
  driver: { id: string; truckersmpId: number | null },
  truckersmpId: number | null,
) {
  if (driver.truckersmpId === truckersmpId) return;
  const save = () => db.driver.update({ where: { id: driver.id }, data: { truckersmpId } });
  try {
    await save();
  } catch (e) {
    if (!isUniqueViolation(e) || truckersmpId === null) return;
    // Another driver still holds this id from a Steam account they have since
    // swapped. TruckersMP just told us whose it is now.
    await db.driver.updateMany({
      where: { truckersmpId, id: { not: driver.id } },
      data: { truckersmpId: null },
    });
    await save().catch(() => undefined);
  }
}

/**
 * Looks the driver up on TruckersMP by their SteamID64 and stores their
 * TruckersMP id (`Driver.truckersmpId`). Run after Steam is linked. Does
 * nothing when TruckersMP can't be reached: every later check that sees the
 * player (registering a company, accepting an application) stores it too.
 */
export async function refreshTruckersmpId(
  db: Database,
  driver: { id: string; steamId64: string | null; truckersmpId: number | null },
  { fetchImpl }: { fetchImpl?: typeof fetch } = {},
) {
  if (!driver.steamId64) return;
  try {
    const found = await player(driver.steamId64, { fetchImpl });
    await rememberTruckersmpId(db, driver, found?.id ?? null);
  } catch (e) {
    if (!(e instanceof TruckersMpError)) throw e;
  }
}
