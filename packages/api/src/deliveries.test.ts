import { randomUUID } from "node:crypto";

import { expect, test } from "bun:test";

import { JobUploadSchema } from "@te-rebrand/telemetry-types";

import fixture from "../../../crates/telemetry/tests/fixtures/job-upload.json";
import { reviewFlaggedJob } from "./deliveries";
import { OutboxPayloadSchema } from "./outbox";
import { driverRank } from "./ranks";
import { makeCompany, makeDriver, makeJob, outbox, testDb } from "./test-db";
import { ingestJob } from "./tracker";

const RANKS = [
  { name: "Rookie", minKm: 0, discordRoleId: "100000000000000001" },
  { name: "Driver", minKm: 2_000, discordRoleId: "100000000000000002" },
  { name: "Senior", minKm: 5_000 },
];

/** The fixture job (Hamburg to Lyon, 1196 km, delivered) as a new upload. */
function upload(change: (u: ReturnType<typeof JobUploadSchema.parse>) => void = () => {}) {
  const u = JobUploadSchema.parse(structuredClone(fixture));
  u.client_job_id = randomUUID();
  change(u);
  return u;
}
const types = (events: { type: string }[]) => events.map((e) => e.type);

test("a delivery for a company goes to the feed, once, with what a message needs", async () => {
  const db = await testDb();
  const company = await makeCompany(db, RANKS);
  const driver = await makeDriver(db, { companyId: company.id });
  const u = upload();

  const saved = await ingestJob(db, driver.device, u);
  expect(saved.status).toBe("delivered");
  expect(saved.companyId).toBe(company.id);

  // The tracker retries until it gets a 2xx: same job, nothing new.
  const again = await ingestJob(db, driver.device, u);
  expect(again.id).toBe(saved.id);
  expect(await db.job.count({ where: { driverId: driver.id } })).toBe(1);

  const events = await outbox(db, company.id);
  expect(events).toEqual([
    {
      type: "job_delivered",
      jobId: saved.id,
      driverId: driver.id,
      driverName: driver.displayName,
      game: "ets2",
      multiplayer: true,
      sourceCity: "Hamburg",
      destCity: "Lyon",
      cargo: "Electronics",
      drivenKm: 1196,
      income: 52400,
    },
  ]);
  for (const e of events) expect(OutboxPayloadSchema.safeParse(e).success).toBe(true);
});

test("the same upload sent twice at once is stored and announced once", async () => {
  const db = await testDb();
  const company = await makeCompany(db, RANKS);
  const driver = await makeDriver(db, { companyId: company.id });
  const u = upload();

  const saved = await Promise.all([1, 2, 3, 4].map(() => ingestJob(db, driver.device, u)));
  expect(new Set(saved.map((j) => j.id)).size).toBe(1);
  expect(types(await outbox(db, company.id))).toEqual(["job_delivered"]);
});

test("flagged, cancelled and solo jobs are not announced", async () => {
  const db = await testDb();
  const company = await makeCompany(db, RANKS);
  const member = await makeDriver(db, { companyId: company.id });
  const solo = await makeDriver(db);

  const flagged = await ingestJob(
    db,
    member.device,
    upload((u) => (u.job.max_speed_kmh = 260)),
  );
  expect(flagged.status).toBe("flagged");
  expect(flagged.reportedAs).toBe("delivered");
  const cancelled = await ingestJob(
    db,
    member.device,
    upload((u) => (u.job.status = "cancelled")),
  );
  expect(cancelled.status).toBe("cancelled");
  const alone = await ingestJob(db, solo.device, upload());
  expect(alone.companyId).toBeNull();

  expect(await outbox(db, company.id)).toEqual([]);
  expect(
    await db.outboxEvent.count({ where: { payload: { path: ["jobId"], equals: alone.id } } }),
  ).toBe(0);
});

test("a rank-up is announced once, and only by the job that crosses the threshold", async () => {
  const db = await testDb();
  const company = await makeCompany(db, RANKS);
  const driver = await makeDriver(db, { companyId: company.id });

  // 1196 km: still Rookie (held from 0 km, so never "reached").
  await ingestJob(db, driver.device, upload());
  expect(types(await outbox(db, company.id))).toEqual(["job_delivered"]);

  // 2392 km: over the 2000 km threshold.
  const crossing = upload();
  await ingestJob(db, driver.device, crossing);
  await ingestJob(db, driver.device, crossing); // retried upload
  const events = await outbox(db, company.id);
  expect(types(events)).toEqual(["job_delivered", "job_delivered", "rank_up"]);
  expect(events[2]).toEqual({
    type: "rank_up",
    driverId: driver.id,
    driverName: driver.displayName,
    rankName: "Driver",
    kmInCompany: 2392,
    discordRoleId: "100000000000000002",
    previousDiscordRoleId: "100000000000000001",
  });
  expect(OutboxPayloadSchema.safeParse(events[2]).success).toBe(true);

  // 3588 km: no threshold in between.
  await ingestJob(db, driver.device, upload());
  expect(types(await outbox(db, company.id)).filter((t) => t === "rank_up")).toHaveLength(1);

  // 5980 km: Senior, which has no Discord role; Driver's is taken away.
  await ingestJob(db, driver.device, upload());
  await ingestJob(db, driver.device, upload());
  const rankUps = (await outbox(db, company.id)).filter((e) => e.type === "rank_up");
  expect(rankUps).toHaveLength(2);
  expect(rankUps[1]).toMatchObject({
    rankName: "Senior",
    discordRoleId: null,
    previousDiscordRoleId: "100000000000000002",
  });
});

test("two jobs arriving at once give one rank-up between them", async () => {
  const db = await testDb();
  const company = await makeCompany(db, [{ name: "Driver", minKm: 2_000 }]);
  const driver = await makeDriver(db, { companyId: company.id });

  await Promise.all([
    ingestJob(db, driver.device, upload()),
    ingestJob(db, driver.device, upload()),
  ]);
  const events = await outbox(db, company.id);
  expect(types(events).sort()).toEqual(["job_delivered", "job_delivered", "rank_up"]);
});

test("distance driven for another company or cancelled does not lift a rank", async () => {
  const db = await testDb();
  const company = await makeCompany(db, RANKS);
  const other = await makeCompany(db, RANKS);
  const driver = await makeDriver(db, { companyId: company.id });
  await makeJob(db, { driverId: driver.id, companyId: other.id, drivenKm: 1_900 });
  await makeJob(db, {
    driverId: driver.id,
    companyId: company.id,
    drivenKm: 1_900,
    status: "cancelled",
  });

  await ingestJob(db, driver.device, upload());
  expect(types(await outbox(db, company.id))).toEqual(["job_delivered"]);
});

test("an approved flagged job counts like a delivery: feed, rank-up, distance", async () => {
  const db = await testDb();
  const company = await makeCompany(db, RANKS);
  const manager = await makeDriver(db, { companyId: company.id, role: "manager" });
  const driver = await makeDriver(db, { companyId: company.id });
  await makeJob(db, { driverId: driver.id, companyId: company.id, drivenKm: 1_500 });
  const flagged = await ingestJob(
    db,
    driver.device,
    upload((u) => (u.job.max_speed_kmh = 260)),
  );
  expect((await driverRank(db, company.id, driver.id)).kmInCompany).toBe(1_500);
  expect(await outbox(db, company.id)).toEqual([]);

  const decision = { companyId: company.id, jobId: flagged.id, reviewerId: manager.id };
  const approved = await reviewFlaggedJob(db, { ...decision, decision: "approve" });
  expect(approved?.status).toBe("delivered");

  const stored = await db.job.findUniqueOrThrow({ where: { id: flagged.id } });
  expect(stored.status).toBe("delivered");
  expect(stored.reviewedById).toBe(manager.id);
  expect(stored.reviewedAt).toBeInstanceOf(Date);

  const rank = await driverRank(db, company.id, driver.id);
  expect(rank.kmInCompany).toBe(2_696);
  expect(rank.current?.name).toBe("Driver");
  const events = await outbox(db, company.id);
  expect(types(events)).toEqual(["job_delivered", "rank_up"]);
  expect(events[0]).toMatchObject({ jobId: flagged.id, drivenKm: 1196 });
  expect(events[1]).toMatchObject({ rankName: "Driver", kmInCompany: 2_696 });

  // Deciding again does nothing, whichever way.
  expect(await reviewFlaggedJob(db, { ...decision, decision: "approve" })).toBeNull();
  expect(await reviewFlaggedJob(db, { ...decision, decision: "reject" })).toBeNull();
  expect(await outbox(db, company.id)).toHaveLength(2);
});

test("two managers approving the same job at once announce it once", async () => {
  const db = await testDb();
  const company = await makeCompany(db, RANKS);
  const manager = await makeDriver(db, { companyId: company.id, role: "manager" });
  const driver = await makeDriver(db, { companyId: company.id });
  const flagged = await makeJob(db, {
    driverId: driver.id,
    companyId: company.id,
    drivenKm: 2_500,
    status: "flagged",
    flagReasons: ["avg_speed"],
  });

  const decision = {
    companyId: company.id,
    jobId: flagged.id,
    reviewerId: manager.id,
    decision: "approve" as const,
  };
  const results = await Promise.all([
    reviewFlaggedJob(db, decision),
    reviewFlaggedJob(db, decision),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(types(await outbox(db, company.id))).toEqual(["job_delivered", "rank_up"]);
});

test("a rejected job leaves the queue and never counts", async () => {
  const db = await testDb();
  const company = await makeCompany(db, RANKS);
  const manager = await makeDriver(db, { companyId: company.id, role: "manager" });
  const driver = await makeDriver(db, { companyId: company.id });
  const flagged = await makeJob(db, {
    driverId: driver.id,
    companyId: company.id,
    drivenKm: 9_000,
    status: "flagged",
    flagReasons: ["odometer_mismatch"],
  });

  const rejected = await reviewFlaggedJob(db, {
    companyId: company.id,
    jobId: flagged.id,
    reviewerId: manager.id,
    decision: "reject",
  });
  expect(rejected?.status).toBe("rejected");
  expect(await db.job.count({ where: { companyId: company.id, status: "flagged" } })).toBe(0);
  expect((await driverRank(db, company.id, driver.id)).kmInCompany).toBe(0);
  expect(await outbox(db, company.id)).toEqual([]);
});

test("approving a flagged job that was cancelled puts it back as cancelled", async () => {
  const db = await testDb();
  const company = await makeCompany(db, RANKS);
  const manager = await makeDriver(db, { companyId: company.id, role: "manager" });
  const driver = await makeDriver(db, { companyId: company.id });
  const flagged = await ingestJob(
    db,
    driver.device,
    upload((u) => {
      u.job.status = "cancelled";
      u.job.max_speed_kmh = 260;
    }),
  );
  expect([flagged.status, flagged.reportedAs]).toEqual(["flagged", "cancelled"]);

  const approved = await reviewFlaggedJob(db, {
    companyId: company.id,
    jobId: flagged.id,
    reviewerId: manager.id,
    decision: "approve",
  });
  expect(approved?.status).toBe("cancelled");
  expect(await outbox(db, company.id)).toEqual([]);
});

test("a job can only be reviewed from its own company", async () => {
  const db = await testDb();
  const company = await makeCompany(db, RANKS);
  const other = await makeCompany(db, RANKS);
  const outsider = await makeDriver(db, { companyId: other.id, role: "owner" });
  const driver = await makeDriver(db, { companyId: company.id });
  const flagged = await makeJob(db, {
    driverId: driver.id,
    companyId: company.id,
    drivenKm: 500,
    status: "flagged",
  });

  const result = await reviewFlaggedJob(db, {
    companyId: other.id,
    jobId: flagged.id,
    reviewerId: outsider.id,
    decision: "approve",
  });
  expect(result).toBeNull();
  expect((await db.job.findUniqueOrThrow({ where: { id: flagged.id } })).status).toBe("flagged");
});
