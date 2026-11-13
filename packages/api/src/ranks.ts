// Ranks: a per-company ladder by distance. A driver's rank is the highest one
// whose distance they have driven in that company, counted from delivered jobs.
// The dashboard, the admin ladder and rank-ups all compute it here.
import type { Database } from "@te-rebrand/db";

import { COUNTS } from "./job-counts";

type RankStep = { minKm: number };

/** Lowest first. Two ranks never share a distance (the API refuses it). */
function ladder<R extends RankStep>(ranks: readonly R[]) {
  return [...ranks].sort((a, b) => a.minKm - b.minKm);
}

/** The rank held at `km`, and the next one up. */
export function rankAt<R extends RankStep>(ranks: readonly R[], km: number) {
  const steps = ladder(ranks);
  return {
    current: steps.filter((r) => r.minKm <= km).at(-1) ?? null,
    next: steps.find((r) => r.minKm > km) ?? null,
  };
}

/**
 * The rank a driver reaches by going from `beforeKm` to `afterKm`, with the
 * one they held before, or null if no threshold was crossed. A job that
 * crosses two thresholds gives the higher rank only.
 */
export function rankReached<R extends RankStep>(
  ranks: readonly R[],
  beforeKm: number,
  afterKm: number,
) {
  const previous = rankAt(ranks, beforeKm).current;
  const rank = rankAt(ranks, afterKm).current;
  if (!rank || (previous && rank.minKm <= previous.minKm)) return null;
  return { rank, previous };
}

export function companyRanks(db: Pick<Database, "rank">, companyId: string) {
  return db.rank.findMany({ where: { companyId }, orderBy: { minKm: "asc" } });
}

/** What the driver has driven for this company, km. */
export async function kmInCompany(
  db: Pick<Database, "job">,
  companyId: string,
  driverId: string,
  /** Leave one job out, to see where the driver stood before it. */
  exceptJobId?: string,
) {
  const sum = await db.job.aggregate({
    where: { companyId, driverId, ...COUNTS, ...(exceptJobId ? { id: { not: exceptJobId } } : {}) },
    _sum: { drivenKm: true },
  });
  return sum._sum.drivenKm ?? 0;
}

/** One driver's place on their company's ladder. */
export async function driverRank(
  db: Pick<Database, "rank" | "job">,
  companyId: string,
  driverId: string,
) {
  const [ranks, km] = await Promise.all([
    companyRanks(db, companyId),
    kmInCompany(db, companyId, driverId),
  ]);
  return { kmInCompany: km, ...rankAt(ranks, km) };
}

/** The whole ladder, with how many active members hold each rank. */
export async function rankLadder(
  db: Pick<Database, "rank" | "job" | "membership">,
  companyId: string,
) {
  const [ranks, members, distances] = await Promise.all([
    companyRanks(db, companyId),
    db.membership.findMany({
      where: { companyId, status: "active" },
      select: { driverId: true },
    }),
    db.job.groupBy({
      by: ["driverId"],
      where: { companyId, ...COUNTS },
      _sum: { drivenKm: true },
    }),
  ]);
  const kmOf = new Map(distances.map((d) => [d.driverId, d._sum.drivenKm ?? 0]));
  const holders = new Map<string, number>();
  let unranked = 0;
  for (const m of members) {
    const rank = rankAt(ranks, kmOf.get(m.driverId) ?? 0).current;
    if (rank) holders.set(rank.id, (holders.get(rank.id) ?? 0) + 1);
    else unranked += 1;
  }
  return {
    ranks: ranks.map((r) => ({ ...r, members: holders.get(r.id) ?? 0 })),
    /** Members below the lowest rank's distance. */
    unranked,
    members: members.length,
  };
}
