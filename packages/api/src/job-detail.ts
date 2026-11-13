// One job with everything the job page shows. Who may ask is decided by the
// caller (routers/jobs.ts) and arrives here as part of `where`.
import type { Database } from "@te-rebrand/db";

import { EVENT_ORDER, readJobEvents } from "./job-events";

/** The job `id` if it was driven by `driverId`, or if it counts for `companyId`. */
export async function jobDetail(
  db: Database,
  where: { id: string } & ({ driverId: string } | { companyId: string }),
) {
  const job = await db.job.findFirst({
    where,
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
      status: true,
      flagReasons: true,
      reportedAs: true,
      reviewedAt: true,
      driver: { select: { id: true, displayName: true } },
      /** The company it counts for; none for a solo job. */
      company: { select: { id: true, name: true, slug: true } },
      events: {
        orderBy: [...EVENT_ORDER],
        select: { id: true, type: true, at: true, payload: true },
      },
    },
  });
  if (!job) return null;
  return { ...job, events: readJobEvents(job.events) };
}
