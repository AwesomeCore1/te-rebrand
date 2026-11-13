import { expect, test } from "bun:test";

import { driverDashboard } from "./dashboard";
import { goalPhase, goalsWithProgress, goalTotal } from "./goals";
import { makeCompany, makeDriver, makeJob, testDb } from "./test-db";

const at = (iso: string) => new Date(iso);
const NOVEMBER = { startAt: at("2026-11-01T00:00:00Z"), endAt: at("2026-11-30T23:59:59.999Z") };

test("a goal is upcoming before its start, past after its end, current in between", () => {
  expect(goalPhase(NOVEMBER, at("2026-10-31T23:59:59Z"))).toBe("upcoming");
  expect(goalPhase(NOVEMBER, at("2026-11-01T00:00:00Z"))).toBe("current");
  expect(goalPhase(NOVEMBER, at("2026-11-30T23:59:59.999Z"))).toBe("current");
  expect(goalPhase(NOVEMBER, at("2026-12-01T00:00:00Z"))).toBe("past");
});

test("progress counts km, jobs or income of delivered jobs inside the dates", async () => {
  const db = await testDb();
  const company = await makeCompany(db);
  const other = await makeCompany(db);
  const [a, b] = await Promise.all([
    makeDriver(db, { companyId: company.id }),
    makeDriver(db, { companyId: company.id }),
  ]);
  const job = { companyId: company.id };
  // Inside November, the first and last moment included.
  await makeJob(db, {
    ...job,
    driverId: a.id,
    drivenKm: 1_000,
    income: 30_000,
    finishedAt: NOVEMBER.startAt,
  });
  await makeJob(db, {
    ...job,
    driverId: a.id,
    drivenKm: 500,
    income: 12_000,
    finishedAt: at("2026-11-15T12:00:00Z"),
  });
  await makeJob(db, {
    ...job,
    driverId: b.id,
    drivenKm: 250,
    income: 8_000,
    finishedAt: NOVEMBER.endAt,
  });
  // Outside the dates, not delivered, or another company's: none of it counts.
  await makeJob(db, {
    ...job,
    driverId: a.id,
    drivenKm: 9_000,
    income: 90_000,
    finishedAt: at("2026-10-31T23:59:59.999Z"),
  });
  await makeJob(db, {
    ...job,
    driverId: a.id,
    drivenKm: 9_000,
    income: 90_000,
    finishedAt: at("2026-12-01T00:00:00Z"),
  });
  for (const status of ["cancelled", "flagged", "rejected"] as const) {
    await makeJob(db, {
      ...job,
      driverId: b.id,
      drivenKm: 9_000,
      income: 90_000,
      status,
      finishedAt: at("2026-11-10T12:00:00Z"),
    });
  }
  await makeJob(db, {
    driverId: a.id,
    companyId: other.id,
    drivenKm: 9_000,
    finishedAt: at("2026-11-10T12:00:00Z"),
  });
  await makeJob(db, {
    driverId: a.id,
    companyId: null,
    drivenKm: 9_000,
    finishedAt: at("2026-11-10T12:00:00Z"),
  });

  const goal = (metric: "km" | "jobs" | "income") => ({
    companyId: company.id,
    metric,
    ...NOVEMBER,
  });
  expect(await goalTotal(db, goal("km"))).toBe(1_750);
  expect(await goalTotal(db, goal("jobs"))).toBe(3);
  expect(await goalTotal(db, goal("income"))).toBe(50_000);
  // One driver's share.
  expect(await goalTotal(db, goal("km"), a.id)).toBe(1_500);
  expect(await goalTotal(db, goal("jobs"), b.id)).toBe(1);
  expect(await goalTotal(db, goal("income"), b.id)).toBe(8_000);
  // A goal with nothing delivered is at 0, not null.
  expect(await goalTotal(db, { ...goal("km"), companyId: (await makeCompany(db)).id })).toBe(0);
});

test("goals are listed running first, then upcoming, then past, each with progress", async () => {
  const db = await testDb();
  const company = await makeCompany(db);
  const driver = await makeDriver(db, { companyId: company.id });
  const now = at("2026-11-13T12:00:00Z");
  const goal = (title: string, startAt: string, endAt: string, metric: "km" | "jobs" = "km") =>
    db.goal.create({
      data: {
        companyId: company.id,
        title,
        metric,
        target: 100,
        startAt: at(startAt),
        endAt: at(endAt),
      },
    });
  await goal("October", "2026-10-01T00:00:00Z", "2026-10-31T23:59:59.999Z");
  await goal("September", "2026-09-01T00:00:00Z", "2026-09-30T23:59:59.999Z");
  await goal("January", "2027-01-01T00:00:00Z", "2027-01-31T23:59:59.999Z");
  await goal("December", "2026-12-01T00:00:00Z", "2026-12-31T23:59:59.999Z");
  await goal("November", "2026-11-01T00:00:00Z", "2026-11-30T23:59:59.999Z");
  await goal("This week", "2026-11-09T00:00:00Z", "2026-11-15T23:59:59.999Z", "jobs");
  const job = { driverId: driver.id, companyId: company.id };
  await makeJob(db, { ...job, drivenKm: 300, finishedAt: at("2026-10-20T12:00:00Z") });
  await makeJob(db, { ...job, drivenKm: 700, finishedAt: at("2026-11-03T12:00:00Z") });
  await makeJob(db, { ...job, drivenKm: 200, finishedAt: at("2026-11-12T12:00:00Z") });

  const goals = await goalsWithProgress(db, company.id, now);
  expect(goals.map((g) => [g.title, g.phase, g.done])).toEqual([
    ["This week", "current", 1],
    ["November", "current", 900],
    ["December", "upcoming", 0],
    ["January", "upcoming", 0],
    ["October", "past", 300],
    ["September", "past", 0],
  ]);
});

test("the dashboard shows the running goal with the same numbers", async () => {
  const db = await testDb();
  const company = await makeCompany(db);
  const [me, mate] = await Promise.all([
    makeDriver(db, { companyId: company.id }),
    makeDriver(db, { companyId: company.id }),
  ]);
  const now = Date.now();
  const stored = await db.goal.create({
    data: {
      companyId: company.id,
      title: "Together",
      metric: "km",
      target: 10_000,
      startAt: new Date(now - 86_400_000),
      endAt: new Date(now + 86_400_000),
    },
  });
  await makeJob(db, { driverId: me.id, companyId: company.id, drivenKm: 400 });
  await makeJob(db, { driverId: mate.id, companyId: company.id, drivenKm: 600 });

  const dash = await driverDashboard(db, me);
  expect(dash.company?.goal).toEqual({ ...stored, done: 1_000, yours: 400 });
  const [listed] = await goalsWithProgress(db, company.id);
  expect(listed?.done).toBe(1_000);
});
