// tRPC side of the live map. Positions themselves are pushed over a WebSocket
// (apps/web/src/routes/api/live/ws.ts, pub/sub in ../live.ts); this router is
// what the map page asks about the viewer, and the membership check the
// company stream goes through.
import { TRPCError } from "@trpc/server";

import type { Context } from "../context";
import { companyProcedure, driverProcedure, router } from "../index";

export const liveRouter = router({
  /** The logged-in viewer: speed unit, privacy toggle, and the company they can watch. */
  viewer: driverProcedure.query(async ({ ctx }) => {
    const membership = await ctx.db.membership.findFirst({
      where: { driverId: ctx.driver.id, status: "active" },
      select: { company: { select: { id: true, name: true, tag: true } } },
    });
    return {
      driverId: ctx.driver.id,
      unitPreference: ctx.driver.unitPreference,
      showOnLiveMap: ctx.driver.showOnLiveMap,
      company: membership?.company ?? null,
    };
  }),

  /** Passes only for an active member of `companyId`. The company stream's gate. */
  companyAccess: companyProcedure("driver").query(({ ctx }) => ({ companyId: ctx.companyId })),
});

/**
 * May this caller watch this company's drivers? Runs `companyProcedure`, the
 * one shared membership check (CLAUDE.md), instead of repeating it for the
 * WebSocket route. False for anyone who is not an active member, logged in or not.
 */
export async function canWatchCompany(ctx: Context, companyId: string) {
  try {
    await liveRouter.createCaller(ctx).companyAccess({ companyId });
    return true;
  } catch (e) {
    if (e instanceof TRPCError && ["UNAUTHORIZED", "FORBIDDEN", "BAD_REQUEST"].includes(e.code)) {
      return false;
    }
    throw e;
  }
}
