import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { driverProcedure, publicProcedure, router } from "../index";
import { event as tmpEvent, TruckersMpError } from "@te-rebrand/truckersmp";

import { tachoConvoys } from "../convoys";
import { driverDashboard } from "../dashboard";
import { approvePairing, livePositions } from "../tracker";
import { applicationsRouter } from "./applications";
import { companyRouter } from "./company";
import { companyAdminRouter } from "./company-admin";
import { jobsRouter } from "./jobs";
import { leaderboardsRouter } from "./leaderboards";
import { liveRouter } from "./live";
import { membershipsRouter } from "./memberships";
import { profilesRouter } from "./profiles";

// Only delivered, unflagged jobs count. Whether cancelled jobs' km count is an
// open decision in docs/PLAN.md; change it here when it's made.
const COUNTS = { status: "delivered" } as const;

const periodSchema = z.enum(["week", "month", "all"]);
function periodStart(period: z.infer<typeof periodSchema>, now = new Date()) {
  if (period === "all") return undefined;
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === "month") d.setUTCDate(1);
  else d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // Monday
  return d;
}

const driverRouter = router({
  /** Everything on the driver dashboard. Company data only for the caller's own company. */
  dashboard: driverProcedure.query(async ({ ctx }) => ({
    driver: ctx.driver,
    ...(await driverDashboard(ctx.db, ctx.driver)),
  })),

  me: driverProcedure.query(async ({ ctx }) => {
    const [membership, totals, perGame] = await Promise.all([
      ctx.db.membership.findFirst({
        where: { driverId: ctx.driver.id, status: "active" },
        include: { company: { select: { id: true, name: true, slug: true, tag: true } } },
      }),
      ctx.db.job.aggregate({
        where: { driverId: ctx.driver.id, ...COUNTS },
        _sum: { drivenKm: true },
        _count: true,
      }),
      ctx.db.job.groupBy({
        by: ["game"],
        where: { driverId: ctx.driver.id, ...COUNTS },
        _sum: { drivenKm: true },
        _count: true,
      }),
    ]);
    return {
      driver: ctx.driver,
      company: membership ? { ...membership.company, role: membership.role } : null,
      totals: { km: totals._sum.drivenKm ?? 0, jobs: totals._count },
      perGame: perGame.map((g) => ({ game: g.game, km: g._sum.drivenKm ?? 0, jobs: g._count })),
    };
  }),

  updateSettings: driverProcedure
    .input(
      z.object({
        unitPreference: z.enum(["km", "mi"]).optional(),
        showOnLiveMap: z.boolean().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.db.driver.update({ where: { id: ctx.driver.id }, data: input }),
    ),

  recentJobs: driverProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(20) }))
    .query(({ ctx, input }) =>
      ctx.db.job.findMany({
        where: { driverId: ctx.driver.id },
        orderBy: { finishedAt: "desc" },
        take: input.limit,
      }),
    ),
});

const trackerRouter = router({
  devices: driverProcedure.query(({ ctx }) =>
    ctx.db.trackerDevice.findMany({
      where: { driverId: ctx.driver.id, revokedAt: null },
      select: { id: true, name: true, appVersion: true, lastSeenAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ),

  revokeDevice: driverProcedure
    .input(z.object({ deviceId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { count } = await ctx.db.trackerDevice.updateMany({
        where: { id: input.deviceId, driverId: ctx.driver.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count === 0) throw new TRPCError({ code: "NOT_FOUND" });
    }),

  approvePairing: driverProcedure
    .input(z.object({ userCode: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const pairing = await approvePairing(ctx.db, ctx.driver.id, input.userCode);
      if (!pairing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That code is wrong or has expired. Start again from the tracker app.",
        });
      }
      return { deviceName: pairing.deviceName };
    }),
});

const eventsRouter = router({
  /** Upcoming convoys hosted by VTCs on Tacho. Public, like the events on TruckersMP. */
  list: publicProcedure.query(({ ctx }) => tachoConvoys(ctx.db, { limit: 40 })),

  /** One TruckersMP event, for the convoy page. Public data, so public. */
  byId: publicProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .query(async ({ input }) => {
      try {
        return await tmpEvent(input.id);
      } catch (e) {
        if (e instanceof TruckersMpError && e.message.includes("HTTP 404")) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "TruckersMP has no event with that ID.",
          });
        }
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "Couldn't reach TruckersMP. Try again in a minute.",
        });
      }
    }),
});

const leaderboardRouter = router({
  /** Public: global, or one company's (company leaderboards are on the public company page). */
  get: publicProcedure
    .input(
      z.object({
        period: periodSchema.default("month"),
        companyId: z.string().optional(),
        game: z.enum(["ets2", "ats"]).optional(),
        limit: z.number().int().min(1).max(100).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const since = periodStart(input.period);
      const rows = await ctx.db.job.groupBy({
        by: ["driverId"],
        where: {
          ...COUNTS,
          ...(input.companyId ? { companyId: input.companyId } : {}),
          ...(input.game ? { game: input.game } : {}),
          ...(since ? { finishedAt: { gte: since } } : {}),
        },
        _sum: { drivenKm: true },
        _count: true,
        orderBy: { _sum: { drivenKm: "desc" } },
        take: input.limit,
      });
      const drivers = await ctx.db.driver.findMany({
        where: { id: { in: rows.map((r) => r.driverId) } },
        select: { id: true, displayName: true },
      });
      const names = new Map(drivers.map((d) => [d.id, d.displayName]));
      return rows.map((r, i) => ({
        rank: i + 1,
        driverId: r.driverId,
        displayName: names.get(r.driverId) ?? "Unknown driver",
        km: r._sum.drivenKm ?? 0,
        jobs: r._count,
      }));
    }),
});

export const appRouter = router({
  healthCheck: publicProcedure.query(() => "OK"),
  driver: driverRouter,
  tracker: trackerRouter,
  company: companyRouter,
  applications: applicationsRouter,
  memberships: membershipsRouter,
  jobs: jobsRouter,
  leaderboard: leaderboardRouter,
  events: eventsRouter,
  live: liveRouter,
  admin: companyAdminRouter,
  leaderboards: leaderboardsRouter,
  profiles: profilesRouter,
  /** Public live map: only drivers who allow it. */
  livePositions: publicProcedure.query(() =>
    livePositions().map(({ driverId, displayName, game, x, z, speed_kmh, server }) => ({
      driverId,
      displayName,
      game,
      x,
      z,
      speed_kmh,
      server,
    })),
  ),
});
export type AppRouter = typeof appRouter;
