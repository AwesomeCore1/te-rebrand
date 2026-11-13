// Which jobs count, and from when. Ranks, goals and leaderboards all use this,
// so a job either counts everywhere or nowhere.
import { z } from "zod";

/**
 * Only delivered jobs count: not cancelled, not flagged, not rejected.
 * Whether cancelled jobs' km should count is an open decision in docs/PLAN.md;
 * change it here when it's made.
 */
export const COUNTS = { status: "delivered" } as const;

export const periodSchema = z.enum(["week", "month", "all"]);
export type Period = z.infer<typeof periodSchema>;

/** Start of the current week (Monday) or month in UTC; nothing for all time. */
export function periodStart(period: Period, now = new Date()) {
  if (period === "all") return undefined;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === "month") d.setUTCDate(1);
  else d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d;
}
