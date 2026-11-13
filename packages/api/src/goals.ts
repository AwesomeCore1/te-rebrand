// Company goals: a target for km, jobs or income between two dates. Progress
// is never stored; it is counted from the company's delivered jobs every time,
// here, for the dashboard and the admin page alike.
import type { Database } from "@te-rebrand/db";

import { COUNTS } from "./job-counts";

type GoalRange = {
  companyId: string;
  metric: "km" | "jobs" | "income";
  startAt: Date;
  endAt: Date;
};

export type GoalPhase = "current" | "upcoming" | "past";

export function goalPhase(goal: { startAt: Date; endAt: Date }, now = new Date()): GoalPhase {
  if (goal.startAt > now) return "upcoming";
  return goal.endAt < now ? "past" : "current";
}

/**
 * How far a goal is: km driven, jobs delivered or income earned by the company
 * between the goal's start and end (both included). With `driverId`, only that
 * driver's share.
 */
export async function goalTotal(db: Pick<Database, "job">, goal: GoalRange, driverId?: string) {
  const sum = await db.job.aggregate({
    where: {
      companyId: goal.companyId,
      ...COUNTS,
      finishedAt: { gte: goal.startAt, lte: goal.endAt },
      ...(driverId ? { driverId } : {}),
    },
    _sum: { drivenKm: true, income: true },
    _count: true,
  });
  if (goal.metric === "jobs") return sum._count;
  return (goal.metric === "income" ? sum._sum.income : sum._sum.drivenKm) ?? 0;
}

/** The goal running right now; with several, the one that ends first. */
export function currentGoal(db: Pick<Database, "goal">, companyId: string, now = new Date()) {
  return db.goal.findFirst({
    where: { companyId, startAt: { lte: now }, endAt: { gte: now } },
    orderBy: { endAt: "asc" },
  });
}

const PHASE_ORDER: Record<GoalPhase, number> = { current: 0, upcoming: 1, past: 2 };

/**
 * Every goal of a company with its progress: running ones first (ending
 * soonest on top), then upcoming (starting soonest), then past (latest first).
 */
export async function goalsWithProgress(
  db: Pick<Database, "goal" | "job">,
  companyId: string,
  now = new Date(),
) {
  const goals = await db.goal.findMany({ where: { companyId } });
  const rows = await Promise.all(
    goals.map(async (goal) => {
      const phase = goalPhase(goal, now);
      // Nothing can have been delivered inside a goal that has not started.
      const done = phase === "upcoming" ? 0 : await goalTotal(db, goal);
      return { ...goal, phase, done };
    }),
  );
  const sortKey = (g: (typeof rows)[number]) =>
    g.phase === "current"
      ? g.endAt.getTime()
      : g.phase === "upcoming"
        ? g.startAt.getTime()
        : -g.endAt.getTime();
  return rows.sort(
    (a, b) => PHASE_ORDER[a.phase] - PHASE_ORDER[b.phase] || sortKey(a) - sortKey(b),
  );
}
