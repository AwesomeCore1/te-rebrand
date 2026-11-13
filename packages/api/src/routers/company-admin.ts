// The parts of the company admin area that are about ranks, goals, flagged
// jobs and settings. Every procedure in here is a `companyProcedure`.
import { router } from "../index";
import { companyProfileRouter } from "./company-profile";
import { goalsRouter } from "./goals";
import { jobReviewRouter } from "./job-review";
import { ranksRouter } from "./ranks";

export const companyAdminRouter = router({
  ranks: ranksRouter,
  goals: goalsRouter,
  jobs: jobReviewRouter,
  settings: companyProfileRouter,
});
