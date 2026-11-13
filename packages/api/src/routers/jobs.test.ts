// Who may open a job page: the driver whose job it is, and managers and owners
// of the company it counts for. Nobody else learns that the job exists: they get
// `null`, or are refused before the job is looked at.
import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import type { Database } from "@te-rebrand/db";
import { JobUploadSchema } from "@te-rebrand/telemetry-types";

import fixture from "../../../../crates/telemetry/tests/fixtures/job-upload.json";
import type { Context } from "../context";
import { makeCompany, makeDriver, makeJob, testDb } from "../test-db";
import { ingestJob } from "../tracker";
import { jobsRouter } from "./jobs";

/**
 * What a call was refused with. Awaited here rather than with bun's
 * `expect(...).rejects`: with that, a call that ends in a job lookup finding
 * nothing now and then never settled under `bun test` (bun 1.4.4, Prisma
 * 7.10), although the database had answered. Awaiting it ourselves never
 * showed that, and neither did 360 calls against the running server.
 */
const refusal = (call: Promise<unknown>) =>
  call.then(
    () => "not refused",
    (e: Error) => e.message,
  );
/** The job, for a caller who is meant to get one. */
function shown<T>(job: T | null): T {
  if (!job) throw new Error("Expected the job, got nothing.");
  return job;
}

const jobs = (ctx: Context) => jobsRouter.createCaller(ctx);
const FORBIDDEN = "Not allowed in this company";

/** A company with one person per role, and a job its driver uploaded with events. */
async function setup(db: Database) {
  const company = await makeCompany(db);
  const [owner, manager, driver, colleague] = await Promise.all([
    makeDriver(db, { companyId: company.id, role: "owner" }),
    makeDriver(db, { companyId: company.id, role: "manager" }),
    makeDriver(db, { companyId: company.id, role: "driver" }),
    makeDriver(db, { companyId: company.id, role: "driver" }),
  ]);
  const upload = JobUploadSchema.parse(structuredClone(fixture));
  upload.client_job_id = randomUUID();
  const job = await ingestJob(db, driver.device, upload);
  return { company, owner, manager, driver, colleague, job };
}

test("the driver sees their own job, with its events in order", async () => {
  const db = await testDb();
  const { company, driver, job } = await setup(db);

  const page = shown(await jobs(driver.ctx).mine({ jobId: job.id }));
  expect(page).toMatchObject({
    id: job.id,
    game: "ets2",
    sourceCity: "Hamburg",
    destCity: "Lyon",
    cargo: "Electronics",
    drivenKm: 1196,
    income: 52400,
    status: "delivered",
    flagReasons: [],
    driver: { id: driver.id, displayName: driver.displayName },
    company: { id: company.id, name: company.name, slug: company.slug },
  });
  // Ids are the database's own; `toEqual` skips a field that is undefined.
  const events: unknown = page.events.map((event) => ({ ...event, id: undefined }));
  expect(events).toEqual([
    { type: "toll", at: new Date("2026-11-12T18:10:00Z"), amount: 38 },
    { type: "fine", at: new Date("2026-11-12T18:25:00Z"), offence: "speeding", amount: 550 },
    {
      type: "ferry",
      at: new Date("2026-11-12T18:40:00Z"),
      source: "Dover",
      target: "Calais",
      amount: 320,
    },
    {
      type: "train",
      at: new Date("2026-11-12T18:55:00Z"),
      source: "Folkestone",
      target: "Calais",
      amount: 265,
    },
  ]);
});

test("managers and owners see a job that counts for their company", async () => {
  const db = await testDb();
  const { company, owner, manager, job } = await setup(db);

  for (const caller of [manager, owner]) {
    const page = shown(await jobs(caller.ctx).inCompany({ companyId: company.id, jobId: job.id }));
    expect(page.id).toBe(job.id);
    expect(page.events).toHaveLength(4);
    // Not theirs, so not through the driver's own way in.
    expect(await jobs(caller.ctx).mine({ jobId: job.id })).toBeNull();
  }
});

test("a colleague without a manager role does not see it", async () => {
  const db = await testDb();
  const { company, colleague, job } = await setup(db);
  expect(await jobs(colleague.ctx).mine({ jobId: job.id })).toBeNull();
  expect(
    await refusal(jobs(colleague.ctx).inCompany({ companyId: company.id, jobId: job.id })),
  ).toContain(FORBIDDEN);
});

test("a manager of another company finds nothing, whichever company id they send", async () => {
  const db = await testDb();
  const [a, b] = [await setup(db), await setup(db)];
  const api = jobs(a.manager.ctx);

  expect(await api.mine({ jobId: b.job.id })).toBeNull();
  // Through their own company: the job is not in it.
  expect(await api.inCompany({ companyId: a.company.id, jobId: b.job.id })).toBeNull();
  // Through the job's company: they have no role there.
  expect(await refusal(api.inCompany({ companyId: b.company.id, jobId: b.job.id }))).toContain(
    FORBIDDEN,
  );
});

test("a job that does not exist reads the same as one that is not yours", async () => {
  const db = await testDb();
  const { company, manager, driver } = await setup(db);
  expect(await jobs(driver.ctx).mine({ jobId: "no-such-job" })).toBeNull();
  expect(
    await jobs(manager.ctx).inCompany({ companyId: company.id, jobId: "no-such-job" }),
  ).toBeNull();
});

test("a solo job is the driver's alone", async () => {
  const db = await testDb();
  const { company, manager } = await setup(db);
  const solo = await makeDriver(db);
  const job = await makeJob(db, { driverId: solo.id, companyId: null, drivenKm: 300 });

  const page = shown(await jobs(solo.ctx).mine({ jobId: job.id }));
  expect(page.company).toBeNull();
  expect(page.events).toEqual([]);
  expect(await jobs(manager.ctx).inCompany({ companyId: company.id, jobId: job.id })).toBeNull();
});

test("the job stays with the company it counted for, and with its driver", async () => {
  const db = await testDb();
  const { company, manager, driver, job } = await setup(db);

  // The driver leaves; a former manager loses the way in.
  await db.membership.updateMany({
    where: { companyId: company.id, driverId: driver.id },
    data: { status: "left", leftAt: new Date() },
  });
  expect(shown(await jobs(driver.ctx).mine({ jobId: job.id })).id).toBe(job.id);
  expect(
    shown(await jobs(manager.ctx).inCompany({ companyId: company.id, jobId: job.id })).driver.id,
  ).toBe(driver.id);
  expect(
    await refusal(jobs(driver.ctx).inCompany({ companyId: company.id, jobId: job.id })),
  ).toContain(FORBIDDEN);

  await db.membership.updateMany({
    where: { companyId: company.id, driverId: manager.id },
    data: { status: "removed", leftAt: new Date() },
  });
  expect(
    await refusal(jobs(manager.ctx).inCompany({ companyId: company.id, jobId: job.id })),
  ).toContain(FORBIDDEN);
});

test("a flagged job shows why, to its driver and to a manager", async () => {
  const db = await testDb();
  const { company, manager, driver } = await setup(db);
  const flagged = await makeJob(db, {
    driverId: driver.id,
    companyId: company.id,
    drivenKm: 800,
    status: "flagged",
    reportedAs: "delivered",
    flagReasons: ["avg_speed", "max_speed"],
  });

  const mine = shown(await jobs(driver.ctx).mine({ jobId: flagged.id }));
  expect(mine).toMatchObject({
    status: "flagged",
    reportedAs: "delivered",
    flagReasons: ["avg_speed", "max_speed"],
  });
  const theirs = shown(
    await jobs(manager.ctx).inCompany({ companyId: company.id, jobId: flagged.id }),
  );
  expect(theirs.flagReasons).toEqual(["avg_speed", "max_speed"]);
});

test("a visitor who is not logged in is refused", async () => {
  const db = await testDb();
  const { company, job } = await setup(db);
  const visitor = jobs({ db, session: null });
  expect(await refusal(visitor.mine({ jobId: job.id }))).toContain("Authentication required");
  expect(await refusal(visitor.inCompany({ companyId: company.id, jobId: job.id }))).toContain(
    "Authentication required",
  );
});
