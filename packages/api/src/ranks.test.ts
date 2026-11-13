import { expect, test } from "bun:test";

import { driverDashboard } from "./dashboard";
import { driverRank, rankAt, rankLadder, rankReached } from "./ranks";
import { makeCompany, makeDriver, makeJob, testDb } from "./test-db";

const LADDER = [
  { name: "Driver", minKm: 5_000 },
  { name: "Rookie", minKm: 0 },
  { name: "Senior", minKm: 15_000 },
];
const name = (r: { name: string } | null) => r?.name ?? null;

test("a rank is held from its distance on, whatever order the ladder is stored in", () => {
  expect(name(rankAt(LADDER, 0).current)).toBe("Rookie");
  expect(name(rankAt(LADDER, 4_999.9).current)).toBe("Rookie");
  expect(name(rankAt(LADDER, 5_000).current)).toBe("Driver");
  expect(name(rankAt(LADDER, 5_000).next)).toBe("Senior");
  expect(name(rankAt(LADDER, 1_000_000).current)).toBe("Senior");
  expect(rankAt(LADDER, 1_000_000).next).toBeNull();
});

test("below the lowest rank a driver is unranked; with no ranks there is nothing", () => {
  const paid = [{ name: "Driver", minKm: 5_000 }];
  expect(rankAt(paid, 4_000)).toEqual({ current: null, next: paid[0]! });
  expect(rankAt([], 4_000)).toEqual({ current: null, next: null });
});

test("a rank is reached only when a threshold is crossed", () => {
  expect(rankReached(LADDER, 0, 4_999)).toBeNull();
  expect(rankReached(LADDER, 5_000, 6_000)).toBeNull();
  const up = rankReached(LADDER, 4_900, 5_000);
  expect([name(up!.rank), name(up!.previous)]).toEqual(["Driver", "Rookie"]);
});

test("crossing two thresholds at once gives the higher rank", () => {
  const up = rankReached(LADDER, 4_000, 20_000);
  expect([name(up!.rank), name(up!.previous)]).toEqual(["Senior", "Rookie"]);
});

test("the first rank is reached from unranked when it does not start at 0", () => {
  const up = rankReached([{ name: "Driver", minKm: 1_000 }], 0, 1_200);
  expect([name(up!.rank), up!.previous]).toEqual(["Driver", null]);
});

test("rank counts delivered km in this company only", async () => {
  const db = await testDb();
  const company = await makeCompany(db, LADDER);
  const other = await makeCompany(db, LADDER);
  const driver = await makeDriver(db, { companyId: company.id });
  const job = { driverId: driver.id, companyId: company.id };
  await makeJob(db, { ...job, drivenKm: 4_000 });
  await makeJob(db, { ...job, drivenKm: 1_500 });
  // None of these count: not delivered, or driven for someone else.
  await makeJob(db, { ...job, drivenKm: 50_000, status: "cancelled" });
  await makeJob(db, { ...job, drivenKm: 50_000, status: "flagged" });
  await makeJob(db, { ...job, drivenKm: 50_000, status: "rejected" });
  await makeJob(db, { driverId: driver.id, companyId: other.id, drivenKm: 50_000 });
  await makeJob(db, { driverId: driver.id, companyId: null, drivenKm: 50_000 });

  const rank = await driverRank(db, company.id, driver.id);
  expect(rank.kmInCompany).toBe(5_500);
  expect([name(rank.current), name(rank.next)]).toEqual(["Driver", "Senior"]);

  // The dashboard shows the same numbers, in the shape its page expects.
  const dash = await driverDashboard(db, driver);
  expect(dash.company?.rank).toEqual({
    kmInCompany: 5_500,
    current: rank.current,
    next: rank.next,
  });
});

test("the ladder counts active members at each rank", async () => {
  const db = await testDb();
  const company = await makeCompany(db, [
    { name: "Driver", minKm: 1_000 },
    { name: "Senior", minKm: 10_000 },
  ]);
  const [fresh, driver, senior, gone] = await Promise.all([
    makeDriver(db, { companyId: company.id }),
    makeDriver(db, { companyId: company.id }),
    makeDriver(db, { companyId: company.id, role: "owner" }),
    makeDriver(db, { companyId: company.id }),
  ]);
  await makeJob(db, { driverId: fresh.id, companyId: company.id, drivenKm: 200 });
  await makeJob(db, { driverId: driver.id, companyId: company.id, drivenKm: 1_000 });
  await makeJob(db, { driverId: senior.id, companyId: company.id, drivenKm: 12_000 });
  // Someone who left still has jobs, but is not counted on the ladder.
  await makeJob(db, { driverId: gone.id, companyId: company.id, drivenKm: 12_000 });
  await db.membership.updateMany({ where: { driverId: gone.id }, data: { status: "left" } });

  const ladder = await rankLadder(db, company.id);
  expect(ladder.ranks.map((r) => [r.name, r.members])).toEqual([
    ["Driver", 1],
    ["Senior", 1],
  ]);
  expect(ladder.unranked).toBe(1);
  expect(ladder.members).toBe(3);
});
