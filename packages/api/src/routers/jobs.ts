// The job page (/jobs/<id>). There are two ways to a job and no third: you
// drove it, or it counts for a company you manage. Anything else gets `null`,
// also for a job that exists, so ids can't be probed. (An answer rather than a
// NOT_FOUND error: a manager's page asks `mine` first for every job it opens.)
import { z } from "zod";

import { companyProcedure, driverProcedure, router } from "../index";
import { jobDetail } from "../job-detail";

const jobInput = z.object({ jobId: z.string().min(1).max(64) });

export const jobsRouter = router({
  /** A job the caller drove, whichever company it counts for. */
  mine: driverProcedure
    .input(jobInput)
    .query(({ ctx, input }) => jobDetail(ctx.db, { id: input.jobId, driverId: ctx.driver.id })),

  /** A job that counts for the company, for its managers and owners. */
  inCompany: companyProcedure("manager")
    .input(jobInput)
    .query(({ ctx, input }) => jobDetail(ctx.db, { id: input.jobId, companyId: ctx.companyId })),
});
