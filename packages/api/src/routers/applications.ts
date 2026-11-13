// Recruitment. A driver applies and can withdraw (their own rows); managers and
// owners read, accept and reject their own company's applications and edit the
// form. Rules are in ../applications.ts.
import { z } from "zod";

import {
  acceptApplication,
  MAX_ANSWER_LENGTH,
  parseAnswers,
  rejectApplication,
  submitApplication,
  withdrawApplication,
} from "../applications";
import { parseCompanySettings, updateCompanySettings } from "../company-settings";
import { companyProcedure, driverProcedure, router } from "../index";

const applicationInput = z.object({ applicationId: z.string().min(1) });

export const applicationsRouter = router({
  /** Send the recruitment form of a company. One answer per question, in order. */
  submit: driverProcedure
    .input(
      z.object({
        companyId: z.string().min(1),
        answers: z.array(z.string().max(MAX_ANSWER_LENGTH)).max(10),
      }),
    )
    .mutation(({ ctx, input }) => submitApplication(ctx.db, ctx.driver, input)),

  /** Take back your own pending application. */
  withdraw: driverProcedure
    .input(applicationInput)
    .mutation(({ ctx, input }) => withdrawApplication(ctx.db, ctx.driver, input.applicationId)),

  /** Pending applications, oldest first, with the answers. */
  pending: companyProcedure("manager").query(async ({ ctx }) => {
    const rows = await ctx.db.application.findMany({
      where: { companyId: ctx.companyId, status: "pending" },
      select: {
        id: true,
        createdAt: true,
        answers: true,
        driver: { select: { id: true, displayName: true, steamId64: true } },
      },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    return rows.map(({ answers, driver, ...row }) => ({
      ...row,
      driver: {
        id: driver.id,
        displayName: driver.displayName,
        steamLinked: driver.steamId64 !== null,
      },
      answers: parseAnswers(answers),
    }));
  }),

  accept: companyProcedure("manager")
    .input(applicationInput)
    .mutation(({ ctx, input }) =>
      acceptApplication(ctx.db, { companyId: ctx.companyId, applicationId: input.applicationId }),
    ),

  reject: companyProcedure("manager")
    .input(applicationInput)
    .mutation(({ ctx, input }) =>
      rejectApplication(ctx.db, { companyId: ctx.companyId, applicationId: input.applicationId }),
    ),

  /** The recruitment form as it is now: open or closed, and the questions. */
  form: companyProcedure("manager").query(async ({ ctx }) => {
    const company = await ctx.db.company.findUniqueOrThrow({
      where: { id: ctx.companyId },
      select: { settings: true },
    });
    return parseCompanySettings(company.settings).recruitment;
  }),

  setForm: companyProcedure("manager")
    .input(
      z.object({
        open: z.boolean(),
        questions: z.array(z.string().trim().min(1).max(200)).max(10),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const settings = await updateCompanySettings(ctx.db, ctx.companyId, (current) => ({
        ...current,
        recruitment: { open: input.open, questions: input.questions },
      }));
      return settings.recruitment;
    }),
});
