// Job events on their way in: uploaded with the job, stored once, timed.
import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import { JobUploadSchema } from "@te-rebrand/telemetry-types";

import fixture from "../../../crates/telemetry/tests/fixtures/job-upload.json";
import { eventTime, readJobEvents } from "./job-events";
import { makeCompany, makeDriver, testDb } from "./test-db";
import { ingestJob } from "./tracker";

/** The fixture job (18:00 to 19:05, one event of each kind) as a new upload. */
function upload(change: (u: ReturnType<typeof JobUploadSchema.parse>) => void = () => {}) {
  const u = JobUploadSchema.parse(structuredClone(fixture));
  u.client_job_id = randomUUID();
  change(u);
  return u;
}

const stored = (db: Awaited<ReturnType<typeof testDb>>, jobId: string) =>
  db.jobEvent.findMany({
    where: { jobId },
    orderBy: [{ at: "asc" }, { id: "asc" }],
    select: { type: true, at: true, payload: true },
  });

test("a job's events are stored with it, in order, with what the game reported", async () => {
  const db = await testDb();
  const driver = await makeDriver(db);
  const job = await ingestJob(db, driver.device, upload());

  expect(await stored(db, job.id)).toEqual([
    { type: "toll", at: new Date("2026-11-12T18:10:00Z"), payload: { amount: 38 } },
    {
      type: "fine",
      at: new Date("2026-11-12T18:25:00Z"),
      payload: { offence: "speeding", amount: 550 },
    },
    {
      type: "ferry",
      at: new Date("2026-11-12T18:40:00Z"),
      payload: { source: "Dover", target: "Calais", amount: 320 },
    },
    {
      type: "train",
      at: new Date("2026-11-12T18:55:00Z"),
      payload: { source: "Folkestone", target: "Calais", amount: 265 },
    },
  ]);
});

test("a retried upload stores no event twice, however many arrive at once", async () => {
  const db = await testDb();
  const company = await makeCompany(db);
  const driver = await makeDriver(db, { companyId: company.id });
  const u = upload();

  const first = await ingestJob(db, driver.device, u);
  const again = await ingestJob(db, driver.device, u);
  expect(again.id).toBe(first.id);
  expect(await db.jobEvent.count({ where: { jobId: first.id } })).toBe(4);

  // The same job from two trackers' retry loops at once.
  const other = upload();
  const saved = await Promise.all([1, 2, 3, 4].map(() => ingestJob(db, driver.device, other)));
  expect(new Set(saved.map((j) => j.id)).size).toBe(1);
  expect(await db.jobEvent.count({ where: { jobId: saved[0]!.id } })).toBe(4);
  expect(await db.jobEvent.count({ where: { job: { driverId: driver.id } } })).toBe(8);
});

test("a job from a tracker without job events is accepted and has none", async () => {
  const db = await testDb();
  const driver = await makeDriver(db);
  const old = structuredClone(fixture) as { client_job_id: string; job: { events?: unknown } };
  delete old.job.events;
  old.client_job_id = randomUUID();

  const parsed = JobUploadSchema.safeParse(old);
  expect(parsed.success).toBe(true);
  const job = await ingestJob(db, driver.device, parsed.data!);
  expect(job.status).toBe("delivered");
  expect(await db.jobEvent.count({ where: { jobId: job.id } })).toBe(0);
});

test("a flagged or cancelled job keeps its events too", async () => {
  const db = await testDb();
  const driver = await makeDriver(db);
  const flagged = await ingestJob(
    db,
    driver.device,
    upload((u) => {
      u.job.max_speed_kmh = 400;
    }),
  );
  expect(flagged.status).toBe("flagged");
  expect(await db.jobEvent.count({ where: { jobId: flagged.id } })).toBe(4);

  const cancelled = await ingestJob(
    db,
    driver.device,
    upload((u) => {
      u.job.status = "cancelled";
    }),
  );
  expect(await db.jobEvent.count({ where: { jobId: cancelled.id } })).toBe(4);
});

test("an event is placed between the job's start and finish", () => {
  // Live: the tracker's clock and the wall clock run at the same pace.
  const live = upload((u) => {
    u.job.started_at_ms = 5_000_000;
    u.job.finished_at_ms = 5_000_000 + 65 * 60_000;
  });
  expect(eventTime(live, 5_000_000 + 10 * 60_000)).toEqual(new Date("2026-11-12T18:10:00Z"));
  expect(eventTime(live, 5_000_000)).toEqual(new Date("2026-11-12T18:00:00Z"));
  expect(eventTime(live, 5_000_000 + 65 * 60_000)).toEqual(new Date("2026-11-12T19:05:00Z"));

  // A replayed recording: 3 s on the tracker's clock stand for the whole job.
  const replay = upload((u) => {
    u.job.started_at_ms = 1000;
    u.job.finished_at_ms = 4000;
  });
  expect(eventTime(replay, 2000).toISOString()).toBe("2026-11-12T18:21:40.000Z");
  expect(eventTime(replay, 3000).toISOString()).toBe("2026-11-12T18:43:20.000Z");

  // Never outside the job.
  expect(eventTime(replay, 0)).toEqual(new Date("2026-11-12T18:00:00Z"));
  expect(eventTime(replay, 9000)).toEqual(new Date("2026-11-12T19:05:00Z"));
});

test("events stay in order when the PC's clock went backwards during the job", () => {
  const u = upload((u) => {
    u.finished_at = "2026-11-12T17:00:00Z"; // before the start: flagged, but kept
  });
  const times = u.job.events.map((e) => eventTime(u, e.at_ms).getTime());
  expect(times).toEqual([...times].sort((a, b) => a - b));
  expect(new Set(times).size).toBe(4);
  expect(times[0]).toBe(new Date("2026-11-12T18:10:00Z").getTime());
});

test("rows are read back by type, and one this code does not know is left out", () => {
  const at = new Date("2026-11-12T18:10:00Z");
  expect(
    readJobEvents([
      { id: "a", type: "toll", at, payload: { amount: 38 } },
      { id: "b", type: "fine", at, payload: { offence: "speeding", amount: 550 } },
      { id: "c", type: "refuel", at, payload: { litres: 300 } },
      { id: "d", type: "ferry", at, payload: { amount: 320 } }, // no ports
      { id: "e", type: "toll", at, payload: null },
    ]),
  ).toEqual([
    { id: "a", at, type: "toll", amount: 38 },
    { id: "b", at, type: "fine", offence: "speeding", amount: 550 },
  ]);
});
