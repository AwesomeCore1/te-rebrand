// Public driver profiles (/driver/<id>). Anyone can read one; what is on it is
// decided in ../driver-profile.ts.
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { driverProfile } from "../driver-profile";
import { publicProcedure, router } from "../index";

export const profilesRouter = router({
  driver: publicProcedure
    .input(z.object({ driverId: z.string().min(1).max(64) }))
    .query(async ({ ctx, input }) => {
      const [profile, viewer] = await Promise.all([
        driverProfile(ctx.db, input.driverId),
        ctx.session
          ? ctx.db.driver.findUnique({
              where: { userId: ctx.session.user.id },
              select: { id: true, unitPreference: true },
            })
          : null,
      ]);
      if (!profile) {
        throw new TRPCError({ code: "NOT_FOUND", message: "There's no driver at this address." });
      }
      return {
        ...profile,
        /** The viewer's unit when logged in; stored distances are always km. */
        unit: viewer?.unitPreference ?? null,
        /** The viewer is looking at their own profile. */
        you: viewer?.id === profile.driverId,
      };
    }),
});
