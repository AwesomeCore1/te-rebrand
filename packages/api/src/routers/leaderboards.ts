// The public leaderboards page: every driver on Tacho together, whatever
// their VTC. Solo drivers are on it too.
import { z } from "zod";

import { publicProcedure, router } from "../index";
import { COUNTS, periodSchema, periodStart } from "../job-counts";

export const leaderboardsRouter = router({
  drivers: publicProcedure
    .input(
      z.object({
        period: periodSchema.default("month"),
        game: z.enum(["ets2", "ats"]).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      const since = periodStart(input.period);
      // The whole board, so a logged-in driver below the cut still gets a
      // place. One row per driver with a counted job in the period.
      const [board, viewer] = await Promise.all([
        ctx.db.job.groupBy({
          by: ["driverId"],
          where: {
            ...COUNTS,
            ...(input.game ? { game: input.game } : {}),
            ...(since ? { finishedAt: { gte: since } } : {}),
          },
          _sum: { drivenKm: true },
          _count: true,
          orderBy: [{ _sum: { drivenKm: "desc" } }, { driverId: "asc" }],
        }),
        ctx.session
          ? ctx.db.driver.findUnique({
              where: { userId: ctx.session.user.id },
              select: { id: true, unitPreference: true },
            })
          : null,
      ]);

      const top = board.slice(0, input.limit);
      const ids = top.map((r) => r.driverId);
      const [drivers, memberships] = await Promise.all([
        ctx.db.driver.findMany({
          where: { id: { in: ids } },
          select: { id: true, displayName: true },
        }),
        ctx.db.membership.findMany({
          where: { driverId: { in: ids }, status: "active" },
          select: { driverId: true, company: { select: { name: true, slug: true, tag: true } } },
        }),
      ]);
      const nameOf = new Map(drivers.map((d) => [d.id, d.displayName]));
      const companyOf = new Map(memberships.map((m) => [m.driverId, m.company]));
      const myPlace = viewer ? board.findIndex((r) => r.driverId === viewer.id) : -1;

      return {
        rows: top.map((r, i) => ({
          place: i + 1,
          driverId: r.driverId,
          displayName: nameOf.get(r.driverId) ?? "Unknown driver",
          /** The VTC the driver is in today; null for solo drivers. */
          company: companyOf.get(r.driverId) ?? null,
          km: r._sum.drivenKm ?? 0,
          jobs: r._count,
          you: r.driverId === viewer?.id,
        })),
        /** The viewer's own row when they are on the board but below the cut. */
        you:
          myPlace >= input.limit
            ? {
                place: myPlace + 1,
                km: board[myPlace]!._sum.drivenKm ?? 0,
                jobs: board[myPlace]!._count,
              }
            : null,
        /** How many drivers are on this board in all. */
        drivers: board.length,
        /** The viewer's unit when logged in; stored distances are always km. */
        unit: viewer?.unitPreference ?? null,
      };
    }),
});
