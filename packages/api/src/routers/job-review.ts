// The review queue: jobs the API flagged, for a company's managers and owners.
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { reviewFlaggedJob } from "../deliveries";
import { companyProcedure, router } from "../index";

const decide = (decision: "approve" | "reject") =>
  companyProcedure("manager")
    .input(z.object({ jobId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const job = await reviewFlaggedJob(ctx.db, {
        companyId: ctx.companyId,
        jobId: input.jobId,
        reviewerId: ctx.driver.id,
        decision,
      });
      if (!job) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "That job is no longer waiting for review.",
        });
      }
      return { id: job.id, status: job.status };
    });

export const jobReviewRouter = router({
  /** Jobs waiting for a decision, newest first, with why they were flagged. */
  flagged: companyProcedure("manager").query(({ ctx }) =>
    ctx.db.job.findMany({
      where: { companyId: ctx.companyId, status: "flagged" },
      orderBy: { finishedAt: "desc" },
      take: 100,
      select: {
        id: true,
        game: true,
        multiplayer: true,
        sourceCity: true,
        sourceCompany: true,
        destCity: true,
        destCompany: true,
        cargo: true,
        cargoMassKg: true,
        plannedKm: true,
        drivenKm: true,
        odometerStart: true,
        odometerEnd: true,
        income: true,
        damagePct: true,
        maxSpeedKmh: true,
        startedAt: true,
        finishedAt: true,
        flagReasons: true,
        reportedAs: true,
        driver: { select: { id: true, displayName: true } },
      },
    }),
  ),

  /** How many are waiting, for a badge on the tab. */
  flaggedCount: companyProcedure("manager").query(({ ctx }) =>
    ctx.db.job.count({ where: { companyId: ctx.companyId, status: "flagged" } }),
  ),

  /** The job counts from now on, like any delivery (feed and rank-up included). */
  approve: decide("approve"),

  /** The job leaves the queue and never counts. */
  reject: decide("reject"),
});
