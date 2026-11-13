// The public driver profile: the same numbers as the leaderboards, the rank
// from the company's ladder, and nothing private.
import { expect, test } from "bun:test";

import { periodStart } from "./job-counts";
import { appRouter } from "./routers/index";
import { makeCompany, makeDriver, makeJob, testDb } from "./test-db";

const db = await testDb();
const anyone = appRouter.createCaller({ db, session: null });

const DAY = 86_400_000;
// "This month" is whatever month the test runs in; "before" is safely outside it.
const thisMonth = () => new Date();
const before = () => new Date(periodStart("month")!.getTime() - 10 * DAY);

/**
 * A driver far ahead of every other test's drivers, so they are on the first
 * page of every board: in a company, with jobs that count and jobs that do not.
 */
async function busyDriver() {
  const company = await makeCompany(db, [
    { name: "Rookie", minKm: 0 },
    { name: "Long hauler", minKm: 3_000_000 },
    { name: "Legend", minKm: 90_000_000 },
  ]);
  await db.company.update({ where: { id: company.id }, data: { tag: "PRF" } });
  const former = await makeCompany(db);
  const driver = await makeDriver(db, { companyId: company.id });
  const job = (extra: Partial<Parameters<typeof makeJob>[1]> & { drivenKm: number }) =>
    makeJob(db, { driverId: driver.id, companyId: company.id, ...extra });

  await job({ drivenKm: 2_000_000, game: "ets2", finishedAt: thisMonth() });
  await job({ drivenKm: 500_000, game: "ats", finishedAt: thisMonth() });
  await job({ drivenKm: 1_250_000.5, game: "ets2", finishedAt: before() });
  // Counted for the driver, not for this company: solo, and for a company they left.
  await job({ drivenKm: 300_000, game: "ats", companyId: null, finishedAt: before() });
  await job({ drivenKm: 700_000, game: "ets2", companyId: former.id, finishedAt: thisMonth() });
  // Never counted.
  await job({ drivenKm: 9_000_000, status: "cancelled", finishedAt: thisMonth() });
  await job({ drivenKm: 9_000_000, status: "flagged", finishedAt: thisMonth() });
  await job({ drivenKm: 9_000_000, status: "rejected", finishedAt: thisMonth() });
  return { company, driver };
}

test("the profile's numbers are the leaderboard's numbers for the same driver", async () => {
  const { driver } = await busyDriver();
  const profile = await anyone.profiles.driver({ driverId: driver.id });

  const row = async (period: "month" | "all", game?: "ets2" | "ats") => {
    const board = await anyone.leaderboards.drivers({ period, game, limit: 100 });
    const found = board.rows.find((r) => r.driverId === driver.id);
    if (!found) throw new Error("the test driver is not on the board");
    return { km: found.km, jobs: found.jobs };
  };

  expect({ km: profile.totals.allTimeKm, jobs: profile.totals.allTimeJobs }).toEqual(
    await row("all"),
  );
  expect({ km: profile.totals.monthKm, jobs: profile.totals.monthJobs }).toEqual(
    await row("month"),
  );
  for (const game of ["ets2", "ats"] as const) {
    const split = profile.perGame.find((g) => g.game === game)!;
    expect({ km: split.allTimeKm, jobs: split.allTimeJobs }).toEqual(await row("all", game));
    expect({ km: split.monthKm, jobs: split.monthJobs }).toEqual(await row("month", game));
  }

  // And they are what was driven: delivered jobs only.
  expect(profile.totals).toEqual({
    allTimeKm: 4_750_000.5,
    allTimeJobs: 5,
    monthKm: 3_200_000,
    monthJobs: 3,
  });
  expect(profile.perGame).toEqual([
    { game: "ets2", allTimeKm: 3_950_000.5, allTimeJobs: 3, monthKm: 2_700_000, monthJobs: 2 },
    { game: "ats", allTimeKm: 800_000, allTimeJobs: 2, monthKm: 500_000, monthJobs: 1 },
  ]);
});

test("company, tag and the rank held there, by distance driven for that company", async () => {
  const { company, driver } = await busyDriver();
  const profile = await anyone.profiles.driver({ driverId: driver.id });

  // 3 750 000.5 km for this company: the solo job and the former company's
  // do not count for the rank.
  expect(profile.company).toEqual({
    name: company.name,
    slug: company.slug,
    tag: "PRF",
    rank: { name: "Long hauler" },
  });
  expect(profile.displayName).toBe(driver.displayName);
  expect(profile.joinedAt).toEqual(driver.createdAt);
});

test("a solo driver, a member below the first rank, and someone who left", async () => {
  const solo = await makeDriver(db);
  await makeJob(db, { driverId: solo.id, companyId: null, drivenKm: 420 });
  const soloProfile = await anyone.profiles.driver({ driverId: solo.id });
  expect(soloProfile.company).toBeNull();
  expect(soloProfile.totals).toMatchObject({ allTimeKm: 420, allTimeJobs: 1 });

  const company = await makeCompany(db, [{ name: "Driver", minKm: 1000 }]);
  const fresh = await makeDriver(db, { companyId: company.id });
  expect((await anyone.profiles.driver({ driverId: fresh.id })).company).toMatchObject({
    slug: company.slug,
    rank: null,
  });
  // Nothing driven yet: zeros, both games listed.
  expect((await anyone.profiles.driver({ driverId: fresh.id })).perGame).toEqual([
    { game: "ets2", allTimeKm: 0, allTimeJobs: 0, monthKm: 0, monthJobs: 0 },
    { game: "ats", allTimeKm: 0, allTimeJobs: 0, monthKm: 0, monthJobs: 0 },
  ]);

  await db.membership.updateMany({ where: { driverId: fresh.id }, data: { status: "left" } });
  expect((await anyone.profiles.driver({ driverId: fresh.id })).company).toBeNull();
});

test("nothing private is on a profile", async () => {
  const company = await makeCompany(db);
  const driver = await makeDriver(db, { companyId: company.id, role: "manager" });
  const steamId64 = "76561198000000042";
  const discordId = "300000000000000042";
  await db.driver.update({ where: { id: driver.id }, data: { steamId64, truckersmpId: 424_242 } });
  await db.account.create({
    data: {
      id: `account-${driver.id}`,
      userId: driver.userId,
      providerId: "discord",
      accountId: discordId,
    },
  });
  await makeJob(db, { driverId: driver.id, companyId: company.id, drivenKm: 100 });

  const profile = await anyone.profiles.driver({ driverId: driver.id });
  expect(Object.keys(profile).sort()).toEqual(
    ["company", "displayName", "driverId", "joinedAt", "perGame", "totals", "unit", "you"].sort(),
  );
  expect(Object.keys(profile.company!).sort()).toEqual(["name", "rank", "slug", "tag"]);
  const text = JSON.stringify(profile);
  for (const secret of [steamId64, discordId, "424242", "Test PC", "manager", "Hamburg"]) {
    expect(text).not.toContain(secret);
  }
});

test("an unknown id is not found", async () => {
  await expect(anyone.profiles.driver({ driverId: "no-such-driver" })).rejects.toMatchObject({
    code: "NOT_FOUND",
    message: "There's no driver at this address.",
  });
  await expect(anyone.profiles.driver({ driverId: "" })).rejects.toThrow();
});

test("distances come with the viewer's unit: none logged out, their own when logged in", async () => {
  const driver = await makeDriver(db);
  const viewer = await makeDriver(db);
  await db.driver.update({ where: { id: viewer.id }, data: { unitPreference: "mi" } });

  expect(await anyone.profiles.driver({ driverId: driver.id })).toMatchObject({
    unit: null,
    you: false,
  });
  expect(
    await appRouter.createCaller(viewer.ctx).profiles.driver({ driverId: driver.id }),
  ).toMatchObject({ unit: "mi", you: false });
  expect(
    await appRouter.createCaller(driver.ctx).profiles.driver({ driverId: driver.id }),
  ).toMatchObject({ unit: "km", you: true });
});
