// Everything the driver dashboard shows, in one query.
import type { Database } from "@te-rebrand/db";
import { companyConvoys, tachoConvoys } from "./convoys";

const COUNTS = { status: "delivered" } as const;

function monthStart(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function driverDashboard(db: Database, driver: { id: string }) {
  const now = new Date();
  const since = monthStart(now);

  const membership = await db.membership.findFirst({
    where: { driverId: driver.id, status: "active" },
    include: {
      company: { select: { id: true, name: true, slug: true, tag: true, truckersmpVtcId: true } },
    },
  });
  const companyId = membership?.companyId;

  const [allTime, thisMonth, perGame, recentJobs, devices] = await Promise.all([
    db.job.aggregate({
      where: { driverId: driver.id, ...COUNTS },
      _sum: { drivenKm: true },
      _count: true,
    }),
    db.job.aggregate({
      where: { driverId: driver.id, ...COUNTS, finishedAt: { gte: since } },
      _sum: { drivenKm: true },
      _count: true,
    }),
    db.job.groupBy({
      by: ["game"],
      where: { driverId: driver.id, ...COUNTS },
      _sum: { drivenKm: true },
      _count: true,
    }),
    db.job.findMany({
      where: { driverId: driver.id },
      orderBy: { finishedAt: "desc" },
      take: 8,
      select: {
        id: true,
        game: true,
        multiplayer: true,
        sourceCity: true,
        destCity: true,
        cargo: true,
        cargoMassKg: true,
        drivenKm: true,
        income: true,
        status: true,
        flagReasons: true,
        finishedAt: true,
      },
    }),
    db.trackerDevice.count({ where: { driverId: driver.id, revokedAt: null } }),
  ]);

  const company = companyId ? await companySide(db, companyId, driver.id, since, now) : null;

  return {
    company: membership ? { ...membership.company, role: membership.role, ...company } : null,
    totals: {
      allTimeKm: allTime._sum.drivenKm ?? 0,
      allTimeJobs: allTime._count,
      monthKm: thisMonth._sum.drivenKm ?? 0,
      monthJobs: thisMonth._count,
    },
    perGame: perGame.map((g) => ({ game: g.game, km: g._sum.drivenKm ?? 0, jobs: g._count })),
    recentJobs,
    hasTracker: devices > 0,
    convoys: await convoys(db, membership?.company ?? null),
  };
}

async function companySide(
  db: Database,
  companyId: string,
  driverId: string,
  since: Date,
  now: Date,
) {
  const [ranks, myCompanyKm, goal, board] = await Promise.all([
    db.rank.findMany({ where: { companyId }, orderBy: { minKm: "asc" } }),
    db.job.aggregate({ where: { driverId, companyId, ...COUNTS }, _sum: { drivenKm: true } }),
    db.goal.findFirst({
      where: { companyId, startAt: { lte: now }, endAt: { gte: now } },
      orderBy: { endAt: "asc" },
    }),
    db.job.groupBy({
      by: ["driverId"],
      where: { companyId, ...COUNTS, finishedAt: { gte: since } },
      _sum: { drivenKm: true },
      _count: true,
      orderBy: { _sum: { drivenKm: "desc" } },
    }),
  ]);

  // Rank: the highest one whose distance the driver has reached in this company.
  const km = myCompanyKm._sum.drivenKm ?? 0;
  const current = ranks.filter((r) => r.minKm <= km).at(-1) ?? null;
  const next = ranks.find((r) => r.minKm > km) ?? null;

  let goalProgress = null;
  if (goal) {
    const range = { companyId, ...COUNTS, finishedAt: { gte: goal.startAt, lte: goal.endAt } };
    const field = goal.metric === "income" ? "income" : "drivenKm";
    const [all, mine] = await Promise.all([
      db.job.aggregate({ where: range, _sum: { drivenKm: true, income: true }, _count: true }),
      db.job.aggregate({
        where: { ...range, driverId },
        _sum: { drivenKm: true, income: true },
        _count: true,
      }),
    ]);
    const value = (a: typeof all) => (goal.metric === "jobs" ? a._count : (a._sum[field] ?? 0));
    goalProgress = { ...goal, done: value(all), yours: value(mine) };
  }

  const top = board.slice(0, 5);
  const names = await db.driver.findMany({
    where: { id: { in: top.map((r) => r.driverId) } },
    select: { id: true, displayName: true },
  });
  const nameOf = new Map(names.map((n) => [n.id, n.displayName]));
  const myPlace = board.findIndex((r) => r.driverId === driverId);

  return {
    rank: { kmInCompany: km, current, next },
    goal: goalProgress,
    leaderboard: {
      rows: top.map((r, i) => ({
        place: i + 1,
        driverId: r.driverId,
        displayName: nameOf.get(r.driverId) ?? "Unknown driver",
        km: r._sum.drivenKm ?? 0,
        jobs: r._count,
        you: r.driverId === driverId,
      })),
      // Shown under the top 5 when the driver isn't in it.
      you:
        myPlace >= 5
          ? {
              place: myPlace + 1,
              km: board[myPlace]!._sum.drivenKm ?? 0,
              jobs: board[myPlace]!._count,
            }
          : null,
    },
  };
}

/**
 * Two lists, both from TruckersMP and only for VTCs on Tacho:
 * - `company`: convoys your company created (null if you're not in one; no
 *   events if the company has no TruckersMP VTC ID yet),
 * - `tacho`: convoys created by the other VTCs on Tacho.
 * If TruckersMP is down the dashboard still loads, with the lists marked unavailable.
 */
async function convoys(
  db: Database,
  company: {
    name: string;
    slug: string;
    tag: string | null;
    truckersmpVtcId: number | null;
  } | null,
) {
  const vtcId = company?.truckersmpVtcId ?? null;
  const [own, others] = await Promise.all([
    company && vtcId !== null
      ? companyConvoys({ ...company, truckersmpVtcId: vtcId }, { limit: 5 })
      : Promise.resolve({ events: [], unavailable: false }),
    tachoConvoys(db, { limit: 5, excludeVtcId: vtcId }),
  ]);
  return {
    company: company ? { name: company.name, hasVtcId: vtcId !== null, ...own } : null,
    tacho: others,
  };
}
