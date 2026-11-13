// A company's goals, for its managers and owners. Progress comes from goals.ts.
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { goalsWithProgress } from "../goals";
import { companyProcedure, router } from "../index";

const goalFields = z.object({
  title: z.string().trim().min(1).max(80),
  metric: z.enum(["km", "jobs", "income"]),
  /** km, a number of jobs, or income in the game's currency. */
  target: z.number().positive().max(1_000_000_000_000),
  /** First and last moment that count, both included. */
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
});

function checkDates(goal: { startAt: Date; endAt: Date }) {
  if (goal.startAt >= goal.endAt) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "A goal has to end after it starts." });
  }
}

export const goalsRouter = router({
  /** Running goals first, then upcoming, then past; each with its progress. */
  list: companyProcedure("manager").query(({ ctx }) => goalsWithProgress(ctx.db, ctx.companyId)),

  create: companyProcedure("manager")
    .input(goalFields)
    .mutation(({ ctx, input }) => {
      const { companyId: _, ...goal } = input;
      checkDates(goal);
      return ctx.db.goal.create({ data: { ...goal, companyId: ctx.companyId } });
    }),

  update: companyProcedure("manager")
    .input(goalFields.extend({ goalId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { companyId: _, goalId, ...goal } = input;
      checkDates(goal);
      // Scoped by companyId, so a manager can't touch another company's goals.
      const { count } = await ctx.db.goal.updateMany({
        where: { id: goalId, companyId: ctx.companyId },
        data: goal,
      });
      if (count === 0) throw new TRPCError({ code: "NOT_FOUND", message: "That goal is gone." });
    }),

  delete: companyProcedure("manager")
    .input(z.object({ goalId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { count } = await ctx.db.goal.deleteMany({
        where: { id: input.goalId, companyId: ctx.companyId },
      });
      if (count === 0) throw new TRPCError({ code: "NOT_FOUND", message: "That goal is gone." });
    }),
});
