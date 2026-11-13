// Recruitment: a driver applies to a company through the form on its public
// page; a manager accepts or rejects. Accepting asks TruckersMP whether the
// applicant really is in the company's VTC, and never gives a driver a second
// active company.
import type { Database } from "@te-rebrand/db";
import { TruckersMpError, vtcMembership } from "@te-rebrand/truckersmp";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { DECISION_MAX_AGE_MS } from "./companies";
import { parseCompanySettings } from "./company-settings";
import { activeMembership, joinCompany, lockDriver, rememberTruckersmpId } from "./memberships";

export const MAX_ANSWER_LENGTH = 1000;

/**
 * `Application.answers`: each answer with the question as it was asked, in the
 * form's order. (A list, because Postgres does not keep the key order of a
 * JSON object, and because the questions may change later.)
 */
const AnswersSchema = z.array(z.object({ question: z.string(), answer: z.string() }));
export type ApplicationAnswer = z.infer<typeof AnswersSchema>[number];

/** Reads the JSON column. Never throws. */
export function parseAnswers(json: unknown): ApplicationAnswer[] {
  const parsed = AnswersSchema.safeParse(json);
  return parsed.success ? parsed.data : [];
}

type DriverRow = { id: string; steamId64: string | null };

/** A driver sends the recruitment form. `answers` line up with the company's questions. */
export async function submitApplication(
  db: Database,
  driver: DriverRow,
  input: { companyId: string; answers: string[] },
  now = new Date(),
) {
  const company = await db.company.findUnique({
    where: { id: input.companyId },
    select: { id: true, name: true, settings: true },
  });
  if (!company) throw new TRPCError({ code: "NOT_FOUND", message: "No such company." });
  const { recruitment } = parseCompanySettings(company.settings);
  if (!recruitment.open) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `${company.name} isn't taking applications right now.`,
    });
  }
  if (!driver.steamId64) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Link Steam before you apply, so the company can check you on TruckersMP.",
    });
  }
  const answers = input.answers.map((a) => a.trim());
  if (answers.length !== recruitment.questions.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The form changed while you were filling it in. Reload the page and send it again.",
    });
  }
  if (answers.some((a) => a.length === 0 || a.length > MAX_ANSWER_LENGTH)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Answer every question." });
  }

  return db.$transaction(async (tx) => {
    await lockDriver(tx, driver.id);
    const current = await activeMembership(tx, driver.id);
    if (current) {
      throw new TRPCError({
        code: "CONFLICT",
        message:
          current.companyId === company.id
            ? `You're already in ${company.name}.`
            : `You're in ${current.company.name}. Leave it before you apply somewhere else.`,
      });
    }
    const pending = await tx.application.count({
      where: { companyId: company.id, driverId: driver.id, status: "pending" },
    });
    if (pending > 0) {
      throw new TRPCError({
        code: "CONFLICT",
        message: `You've already applied to ${company.name}.`,
      });
    }
    return tx.application.create({
      data: {
        companyId: company.id,
        driverId: driver.id,
        status: "pending",
        createdAt: now,
        answers: recruitment.questions.map((question, i) => ({ question, answer: answers[i]! })),
      },
      select: { id: true, createdAt: true },
    });
  });
}

/** A driver takes back their own pending application. */
export async function withdrawApplication(
  db: Database,
  driver: { id: string },
  applicationId: string,
  now = new Date(),
) {
  const { count } = await db.application.updateMany({
    where: { id: applicationId, driverId: driver.id, status: "pending" },
    data: { status: "withdrawn", decidedAt: now },
  });
  if (count === 0) {
    throw new TRPCError({ code: "NOT_FOUND", message: "That application is no longer open." });
  }
}

const GONE = "That application is no longer open.";

/**
 * A manager accepts an application. In order:
 * 1. TruckersMP must say the applicant is in this company's VTC.
 * 2. The applicant must have no active company on Tacho.
 * Then the membership is created and the application closed, in one transaction.
 *
 * A company without a TruckersMP VTC id skips step 1: there is nothing to check
 * against. New companies always have one; only hand-made test companies don't.
 */
export async function acceptApplication(
  db: Database,
  input: { companyId: string; applicationId: string },
  { fetchImpl, now = new Date() }: { fetchImpl?: typeof fetch; now?: Date } = {},
) {
  // Scoped by companyId: an application of another company is "not found".
  const application = await db.application.findFirst({
    where: { id: input.applicationId, companyId: input.companyId, status: "pending" },
    include: {
      driver: { select: { id: true, displayName: true, steamId64: true, truckersmpId: true } },
      company: { select: { name: true, truckersmpVtcId: true } },
    },
  });
  if (!application) throw new TRPCError({ code: "NOT_FOUND", message: GONE });
  const { driver, company } = application;

  const vtcId = company.truckersmpVtcId;
  if (vtcId !== null) {
    if (!driver.steamId64) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: `${driver.displayName} has no Steam account linked, so TruckersMP can't be checked.`,
      });
    }
    let check;
    try {
      check = await vtcMembership(driver.steamId64, vtcId, {
        fetchImpl,
        maxAgeMs: DECISION_MAX_AGE_MS,
      });
    } catch (e) {
      if (!(e instanceof TruckersMpError)) throw e;
      throw new TRPCError({
        code: "BAD_GATEWAY",
        message: "Couldn't reach TruckersMP to check the membership. Nothing was changed.",
      });
    }
    await rememberTruckersmpId(db, driver, check.player?.id ?? null);
    if (!check.member) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: check.player
          ? `${driver.displayName} isn't in ${company.name} on TruckersMP yet. They join the VTC there first; then accept again.`
          : `${driver.displayName}'s Steam account has no TruckersMP account.`,
      });
    }
  }

  return db.$transaction(async (tx) => {
    const membership = await joinCompany(
      tx,
      {
        companyId: input.companyId,
        driverId: driver.id,
        role: "driver",
        now,
        checkedVtc: vtcId !== null,
      },
      (name) => `${driver.displayName} is already in ${name} on Tacho. They leave it first.`,
    );
    const { count } = await tx.application.updateMany({
      where: { id: application.id, companyId: input.companyId, status: "pending" },
      data: { status: "accepted", decidedAt: now },
    });
    // Withdrawn or decided by someone else a moment ago: undo the membership.
    if (count === 0) throw new TRPCError({ code: "NOT_FOUND", message: GONE });
    // They can only be in one company, so their other applications are off.
    await tx.application.updateMany({
      where: { driverId: driver.id, status: "pending" },
      data: { status: "withdrawn", decidedAt: now },
    });
    return { membershipId: membership.id, displayName: driver.displayName };
  });
}

export async function rejectApplication(
  db: Database,
  input: { companyId: string; applicationId: string },
  now = new Date(),
) {
  const { count } = await db.application.updateMany({
    where: { id: input.applicationId, companyId: input.companyId, status: "pending" },
    data: { status: "rejected", decidedAt: now },
  });
  if (count === 0) throw new TRPCError({ code: "NOT_FOUND", message: GONE });
}
