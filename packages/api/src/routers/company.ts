// Companies: registering one, its public page, and its member list.
// Applications are in applications.ts; removing and leaving in memberships.ts;
// ranks, goals, flagged-job review and settings in company-admin.ts.
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createCompany, registrationStatus } from "../companies";
import { parseCompanySettings } from "../company-settings";
import { companyConvoys } from "../convoys";
import { companyProcedure, driverProcedure, publicProcedure, router } from "../index";
import { COUNTS, periodStart } from "../job-counts";
import { livePositions } from "../tracker";

const slugInput = z.object({ slug: z.string().min(1).max(80) });

export const companyRouter = router({
  bySlug: publicProcedure.input(z.object({ slug: z.string() })).query(async ({ ctx, input }) => {
    const company = await ctx.db.company.findUnique({
      where: { slug: input.slug },
      select: {
        id: true,
        name: true,
        slug: true,
        tag: true,
        logoUrl: true,
        verifiedAt: true,
        _count: { select: { memberships: { where: { status: "active" } } } },
      },
    });
    if (!company) throw new TRPCError({ code: "NOT_FOUND" });
    return company;
  }),

  /**
   * The public company page: who they are, the About text, the recruitment
   * form's questions, and totals. Public, so nothing from the admin side.
   * Totals count delivered jobs only, like everywhere else.
   */
  page: publicProcedure.input(slugInput).query(async ({ ctx, input }) => {
    const company = await ctx.db.company.findUnique({
      where: { slug: input.slug },
      select: {
        id: true,
        name: true,
        slug: true,
        tag: true,
        logoUrl: true,
        verifiedAt: true,
        truckersmpVtcId: true,
        settings: true,
      },
    });
    if (!company) {
      throw new TRPCError({ code: "NOT_FOUND", message: "There's no company at this address." });
    }
    const counted = { companyId: company.id, ...COUNTS };
    const [members, allTime, month] = await Promise.all([
      ctx.db.membership.count({ where: { companyId: company.id, status: "active" } }),
      ctx.db.job.aggregate({ where: counted, _sum: { drivenKm: true }, _count: true }),
      ctx.db.job.aggregate({
        where: { ...counted, finishedAt: { gte: periodStart("month") } },
        _sum: { drivenKm: true },
        _count: true,
      }),
    ]);
    const { settings: json, ...rest } = company;
    const settings = parseCompanySettings(json);
    return {
      ...rest,
      about: settings.about,
      recruitment: settings.recruitment,
      stats: {
        members,
        monthKm: month._sum.drivenKm ?? 0,
        monthJobs: month._count,
        allTimeKm: allTime._sum.drivenKm ?? 0,
        allTimeJobs: allTime._count,
      },
    };
  }),

  /**
   * Upcoming convoys the company created on TruckersMP. Its own query, so a
   * slow TruckersMP never holds up the rest of the page. `hasVtc` is false for
   * a company with no verified TruckersMP VTC: then there is nothing to show.
   */
  convoys: publicProcedure.input(slugInput).query(async ({ ctx, input }) => {
    const company = await ctx.db.company.findUnique({
      where: { slug: input.slug },
      select: { name: true, slug: true, tag: true, truckersmpVtcId: true, verifiedAt: true },
    });
    if (!company) throw new TRPCError({ code: "NOT_FOUND" });
    const { truckersmpVtcId, verifiedAt, ...names } = company;
    if (truckersmpVtcId === null || verifiedAt === null) {
      return { hasVtc: false, events: [], unavailable: false };
    }
    return { hasVtc: true, ...(await companyConvoys({ ...names, truckersmpVtcId })) };
  }),

  /**
   * What the person looking at a company page is to that company: logged out,
   * a member, an applicant, in another company, or free to apply. Also their
   * km/mi preference. Only ever about the caller's own rows.
   */
  viewer: publicProcedure.input(slugInput).query(async ({ ctx, input }) => {
    if (!ctx.session) return { signedIn: false as const };
    const [driver, company] = await Promise.all([
      ctx.db.driver.findUnique({
        where: { userId: ctx.session.user.id },
        select: { id: true, unitPreference: true, steamId64: true },
      }),
      ctx.db.company.findUnique({ where: { slug: input.slug }, select: { id: true } }),
    ]);
    if (!company) throw new TRPCError({ code: "NOT_FOUND" });
    // Logged in but never opened the dashboard: no driver profile yet.
    if (!driver) {
      return {
        signedIn: true as const,
        driverId: null,
        unit: "km" as const,
        steamLinked: false,
        membership: null,
        application: null,
      };
    }
    const [membership, application] = await Promise.all([
      ctx.db.membership.findFirst({
        where: { driverId: driver.id, status: "active" },
        select: {
          id: true,
          role: true,
          joinedAt: true,
          company: { select: { id: true, name: true, slug: true } },
        },
      }),
      ctx.db.application.findFirst({
        where: { driverId: driver.id, companyId: company.id, status: "pending" },
        select: { id: true, createdAt: true },
        orderBy: { createdAt: "desc" },
      }),
    ]);
    return {
      signedIn: true as const,
      /** To mark the caller's own row on the leaderboard. */
      driverId: driver.id as string | null,
      unit: driver.unitPreference,
      steamLinked: driver.steamId64 !== null,
      membership: membership
        ? {
            role: membership.role,
            joinedAt: membership.joinedAt,
            company: membership.company,
            /** In the company whose page this is. */
            here: membership.company.id === company.id,
          }
        : null,
      application,
    };
  }),

  /**
   * For /vtc/new: which TruckersMP VTC the caller could register, or why not.
   * `fresh` asks TruckersMP again instead of using a cached answer (the "Check
   * again" button, after someone changed things there).
   */
  registration: driverProcedure
    .input(z.object({ fresh: z.boolean().default(false) }).default({ fresh: false }))
    .query(({ ctx, input }) =>
      registrationStatus(ctx.db, ctx.driver, { maxAgeMs: input.fresh ? 30_000 : undefined }),
    ),

  /** Registers the caller's TruckersMP VTC as a company, with them as owner. */
  create: driverProcedure
    .input(z.object({ vtcId: z.number().int().positive() }))
    .mutation(({ ctx, input }) => createCompany(ctx.db, ctx.driver, input)),

  /** Active members, with what each has driven for the company. Oldest member first. */
  members: companyProcedure("driver").query(async ({ ctx }) => {
    const [members, driven] = await Promise.all([
      ctx.db.membership.findMany({
        where: { companyId: ctx.companyId, status: "active" },
        select: {
          id: true,
          role: true,
          joinedAt: true,
          driver: { select: { id: true, displayName: true } },
        },
        orderBy: { joinedAt: "asc" },
      }),
      ctx.db.job.groupBy({
        by: ["driverId"],
        where: { companyId: ctx.companyId, ...COUNTS },
        _sum: { drivenKm: true },
        _count: true,
      }),
    ]);
    const byDriver = new Map(driven.map((d) => [d.driverId, d]));
    return members.map((m) => ({
      ...m,
      /** The caller's own row. */
      you: m.id === ctx.membership.id,
      kmInCompany: byDriver.get(m.driver.id)?._sum.drivenKm ?? 0,
      jobsInCompany: byDriver.get(m.driver.id)?._count ?? 0,
    }));
  }),

  flaggedJobs: companyProcedure("manager").query(({ ctx }) =>
    ctx.db.job.findMany({
      where: { companyId: ctx.companyId, status: "flagged" },
      include: { driver: { select: { displayName: true } } },
      orderBy: { finishedAt: "desc" },
      take: 100,
    }),
  ),

  setMemberRole: companyProcedure("owner")
    .input(z.object({ membershipId: z.string(), role: z.enum(["manager", "driver"]) }))
    .mutation(async ({ ctx, input }) => {
      // Scoped by companyId, so an owner can't touch another company's rows.
      // The owner's own row never matches, so the owner can't be demoted.
      const { count } = await ctx.db.membership.updateMany({
        where: {
          id: input.membershipId,
          companyId: ctx.companyId,
          status: "active",
          role: { not: "owner" },
        },
        data: { role: input.role },
      });
      if (count === 0) throw new TRPCError({ code: "NOT_FOUND" });
    }),

  livePositions: companyProcedure("driver").query(({ ctx }) =>
    livePositions({ companyId: ctx.companyId }).map(
      ({ driverId, displayName, game, x, z, speed_kmh, server }) => ({
        driverId,
        displayName,
        game,
        x,
        z,
        speed_kmh,
        server,
      }),
    ),
  ),
});
