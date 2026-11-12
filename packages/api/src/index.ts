import { initTRPC, TRPCError } from "@trpc/server";
import { z } from "zod";

import type { Context } from "./context";

export const t = initTRPC.context<Context>().create();

export const router = t.router;

export const publicProcedure = t.procedure;

export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Authentication required",
      cause: "No session",
    });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

/** Logged in, with the caller's Driver profile on ctx (created on sign-up). */
export const driverProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const driver = await ctx.db.driver.upsert({
    where: { userId: ctx.session.user.id },
    create: { userId: ctx.session.user.id, displayName: ctx.session.user.name },
    update: {},
  });
  return next({ ctx: { ...ctx, driver } });
});

export type CompanyRole = "owner" | "manager" | "driver";
const ROLE_LEVEL: Record<CompanyRole, number> = { driver: 0, manager: 1, owner: 2 };

/**
 * The one place that keeps VTCs apart (CLAUDE.md). Every procedure that reads
 * or writes company-owned rows takes `companyId` in its input and is built from
 * this, so the caller's active membership and role are checked before the
 * handler runs. Never check roles inside a route.
 */
export function companyProcedure(minRole: CompanyRole = "driver") {
  return driverProcedure
    .input(z.object({ companyId: z.string().min(1) }))
    .use(async ({ ctx, input, next }) => {
      const membership = await ctx.db.membership.findFirst({
        where: { companyId: input.companyId, driverId: ctx.driver.id, status: "active" },
      });
      if (!membership || ROLE_LEVEL[membership.role] < ROLE_LEVEL[minRole]) {
        // Same error whether the company exists or not, so ids can't be probed.
        throw new TRPCError({ code: "FORBIDDEN", message: "Not allowed in this company" });
      }
      return next({ ctx: { ...ctx, membership, companyId: input.companyId } });
    });
}
