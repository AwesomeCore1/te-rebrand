// What happens when a job starts to count as a delivery for a company: the
// Discord bot hears about it (delivery feed), and about a rank-up if this job
// took the driver over a threshold. There are two ways in: the tracker uploads
// a clean job (`ingestJob`), or a manager approves a flagged one.
import type { Database } from "@te-rebrand/db";

import { enqueueOutbox } from "./outbox";
import { companyRanks, kmInCompany, rankReached } from "./ranks";

/** What the callback of `db.$transaction` gets. */
type Tx = Parameters<Parameters<Database["$transaction"]>[0]>[0];

/**
 * One job at a time per driver. Rank-ups compare the driver's distance before
 * and after a job, so two jobs of the same driver must not be counted at once;
 * it also makes a second upload of the same job wait for the first.
 */
export async function lockDriver(tx: Tx, driverId: string) {
  await tx.$queryRaw`SELECT id FROM driver WHERE id = ${driverId} FOR UPDATE`;
}

type CountedJob = {
  id: string;
  driverId: string;
  companyId: string | null;
  status: string;
  game: "ets2" | "ats";
  multiplayer: boolean;
  sourceCity: string;
  destCity: string;
  cargo: string;
  drivenKm: number;
  income: number;
};

/**
 * Call once, in the transaction that made `job` count (after `lockDriver`).
 * Solo jobs and jobs that are not `delivered` announce nothing.
 */
export async function announceDelivery(tx: Tx, job: CountedJob) {
  if (!job.companyId || job.status !== "delivered") return;
  const companyId = job.companyId;
  const driver = await tx.driver.findUniqueOrThrow({
    where: { id: job.driverId },
    select: { displayName: true },
  });
  const ranks = await companyRanks(tx, companyId);
  const beforeKm = await kmInCompany(tx, companyId, job.driverId, job.id);

  await enqueueOutbox(tx, companyId, {
    type: "job_delivered",
    jobId: job.id,
    driverId: job.driverId,
    driverName: driver.displayName,
    game: job.game,
    multiplayer: job.multiplayer,
    sourceCity: job.sourceCity,
    destCity: job.destCity,
    cargo: job.cargo,
    drivenKm: job.drivenKm,
    income: job.income,
  });

  const afterKm = beforeKm + job.drivenKm;
  const reached = rankReached(ranks, beforeKm, afterKm);
  if (reached) {
    await enqueueOutbox(tx, companyId, {
      type: "rank_up",
      driverId: job.driverId,
      driverName: driver.displayName,
      rankName: reached.rank.name,
      kmInCompany: afterKm,
      discordRoleId: reached.rank.discordRoleId,
      previousDiscordRoleId: reached.previous?.discordRoleId ?? null,
    });
  }
}

/**
 * A manager's decision on a flagged job. Approved: it gets the status the
 * tracker reported and from then on counts like any other delivery. Rejected:
 * it leaves the queue and never counts. Returns null when the job is not
 * waiting for review in this company (wrong company, or already decided).
 */
export function reviewFlaggedJob(
  db: Database,
  input: { companyId: string; jobId: string; reviewerId: string; decision: "approve" | "reject" },
) {
  const waiting = { id: input.jobId, companyId: input.companyId, status: "flagged" } as const;
  return db.$transaction(async (tx) => {
    const job = await tx.job.findFirst({ where: waiting });
    if (!job) return null;
    await lockDriver(tx, job.driverId);
    const status =
      input.decision === "reject"
        ? ("rejected" as const)
        : job.reportedAs === "cancelled"
          ? ("cancelled" as const)
          : ("delivered" as const);
    // Checks `flagged` again: of two managers deciding at once, one gets 0.
    const { count } = await tx.job.updateMany({
      where: waiting,
      data: { status, reviewedAt: new Date(), reviewedById: input.reviewerId },
    });
    if (count === 0) return null;
    const reviewed = { ...job, status };
    await announceDelivery(tx, reviewed);
    return reviewed;
  });
}
