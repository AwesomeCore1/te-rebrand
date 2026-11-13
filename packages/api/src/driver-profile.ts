// A driver's public profile: what the leaderboards already show about them,
// in one place. Name, company and rank, and totals from counted jobs. Nothing
// else leaves here: no job list, no Steam or Discord id, nothing about their
// trackers, not their role in the company.
import type { Database } from "@te-rebrand/db";

import { COUNTS, periodStart } from "./job-counts";
import { driverRank } from "./ranks";

type Db = Pick<Database, "driver" | "membership" | "job" | "rank">;

const GAMES = ["ets2", "ats"] as const;

/** Null when there is no such driver. `now` decides which month "this month" is. */
export async function driverProfile(db: Db, driverId: string, now = new Date()) {
  const driver = await db.driver.findUnique({
    where: { id: driverId },
    select: { id: true, displayName: true, createdAt: true },
  });
  if (!driver) return null;

  // The same jobs and the same month as the leaderboards (job-counts.ts).
  const counted = { driverId: driver.id, ...COUNTS };
  const thisMonth = { ...counted, finishedAt: { gte: periodStart("month", now) } };
  const [membership, allTime, month] = await Promise.all([
    db.membership.findFirst({
      where: { driverId: driver.id, status: "active" },
      select: { companyId: true, company: { select: { name: true, slug: true, tag: true } } },
    }),
    db.job.groupBy({ by: ["game"], where: counted, _sum: { drivenKm: true }, _count: true }),
    db.job.groupBy({ by: ["game"], where: thisMonth, _sum: { drivenKm: true }, _count: true }),
  ]);
  // Their place on the company's ladder, worked out where every rank is (ranks.ts).
  const rank = membership ? await driverRank(db, membership.companyId, driver.id) : null;

  const perGame = GAMES.map((game) => {
    const all = allTime.find((g) => g.game === game);
    const recent = month.find((g) => g.game === game);
    return {
      game,
      allTimeKm: all?._sum.drivenKm ?? 0,
      allTimeJobs: all?._count ?? 0,
      monthKm: recent?._sum.drivenKm ?? 0,
      monthJobs: recent?._count ?? 0,
    };
  });
  const sum = (pick: (g: (typeof perGame)[number]) => number) =>
    perGame.reduce((total, g) => total + pick(g), 0);

  return {
    driverId: driver.id,
    displayName: driver.displayName,
    /** When their Tacho profile was made. */
    joinedAt: driver.createdAt,
    /** The VTC they drive for today, with the rank they hold there; null for a solo driver. */
    company: membership
      ? { ...membership.company, rank: rank?.current ? { name: rank.current.name } : null }
      : null,
    totals: {
      allTimeKm: sum((g) => g.allTimeKm),
      allTimeJobs: sum((g) => g.allTimeJobs),
      monthKm: sum((g) => g.monthKm),
      monthJobs: sum((g) => g.monthJobs),
    },
    /** Both games, always in the same order, zeros included. */
    perGame,
  };
}
