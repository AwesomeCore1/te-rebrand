import { beforeEach, expect, test } from "bun:test";

import type { Database } from "@te-rebrand/db";
import { clearCache } from "@te-rebrand/truckersmp";

import {
  checkMemberships,
  type MembershipCheckResult,
  startMembershipSchedule,
  summarise,
} from "./membership-check";
import { makeCompany, makeDriver, testDb } from "./test-db";
import { fakeTruckersMp, linkSteam } from "./test-truckersmp";

const db = await testDb();

// Other test files leave companies with a VTC id behind in the shared test
// database. Each test here starts with only its own: everyone else is marked
// as just checked, far in the future of the clocks used below.
beforeEach(async () => {
  clearCache();
  await db.membership.updateMany({ data: { lastVtcCheckAt: new Date("2030-01-01T00:00:00Z") } });
});

const NIGHT = new Date("2026-11-14T03:00:00Z");
const HOUR = 3_600_000;

/** A company on Tacho with a VTC on the pretend TruckersMP, and its owner. */
async function vtcCompany(tmp: ReturnType<typeof fakeTruckersMp>) {
  const company = await makeCompany(db);
  const owner = await linkSteam(db, await makeDriver(db, { companyId: company.id, role: "owner" }));
  const vtc = tmp.addVtc(company.name, owner.steamId64);
  await db.company.update({ where: { id: company.id }, data: { truckersmpVtcId: vtc.id } });
  const member = async (role: "manager" | "driver" = "driver") => {
    const driver = await linkSteam(db, await makeDriver(db, { companyId: company.id, role }));
    tmp.join(driver.steamId64, vtc.id);
    return driver;
  };
  return { company, owner, vtc, member };
}

/** Runs the check with a fake clock and a `sleep` that only records. */
function run(
  tmp: ReturnType<typeof fakeTruckersMp>,
  options: Parameters<typeof checkMemberships>[1] = {},
) {
  const sleeps: number[] = [];
  return checkMemberships(db, {
    fetchImpl: tmp.fetchImpl,
    now: () => NIGHT,
    sleep: async (ms) => void sleeps.push(ms),
    ...options,
  }).then((result) => ({ ...result, sleeps }));
}
const rowOf = (driverId: string) => db.membership.findFirstOrThrow({ where: { driverId } });
const reset = (database: Database, companyId: string) =>
  database.membership.updateMany({ where: { companyId }, data: { lastVtcCheckAt: null } });

test("members still in the VTC are confirmed with one request for the whole company", async () => {
  const tmp = fakeTruckersMp();
  const { company, owner, vtc, member } = await vtcCompany(tmp);
  const a = await member();
  const b = await member("manager");
  await reset(db, company.id);

  const result = await run(tmp);
  expect(result).toMatchObject({ companies: 1, confirmed: 3, requests: 1, rateLimited: false });
  expect(result.deactivated).toEqual([]);
  expect(tmp.calls).toEqual([`/vtc/${vtc.id}/members`]);
  for (const d of [owner, a, b]) {
    expect(await rowOf(d.id)).toMatchObject({
      status: "active",
      lastVtcCheckAt: NIGHT,
      leftAt: null,
    });
  }
});

test("a member who left the VTC on TruckersMP becomes inactive, with the time", async () => {
  const tmp = fakeTruckersMp();
  const { company, vtc, member } = await vtcCompany(tmp);
  const stays = await member();
  const leftForNothing = await member();
  const leftForAnother = await member("manager");
  await reset(db, company.id);
  tmp.leave(leftForNothing.steamId64);
  tmp.join(leftForAnother.steamId64, tmp.addVtc("Rival Lines", stays.steamId64 + "0").id);
  // (`stays` is still in the first VTC; the rival VTC has a made-up owner.)

  const result = await run(tmp);
  expect(result.confirmed).toBe(2);
  expect(result.deactivated.map((d) => d.driver).sort()).toEqual(
    [leftForNothing.displayName, leftForAnother.displayName].sort(),
  );
  for (const d of [leftForNothing, leftForAnother]) {
    expect(await rowOf(d.id)).toMatchObject({
      status: "inactive",
      leftAt: NIGHT,
      lastVtcCheckAt: NIGHT,
    });
  }
  expect(await rowOf(stays.id)).toMatchObject({ status: "active", leftAt: null });
  // The list, then one question per person who seemed gone.
  expect(tmp.calls).toEqual([
    `/vtc/${vtc.id}/members`,
    `/player/${leftForNothing.steamId64}`,
    `/player/${leftForAnother.steamId64}`,
  ]);
  expect(summarise(result)).toContain("2 left their VTC");
});

test("a member list that was cut short deactivates nobody who is still there", async () => {
  const tmp = fakeTruckersMp();
  const { company, vtc, member } = await vtcCompany(tmp);
  const a = await member();
  const b = await member();
  await reset(db, company.id);
  // TruckersMP only returns the first member (the owner).
  tmp.shortLists.set(vtc.id, 1);

  const result = await run(tmp);
  expect(result.deactivated).toEqual([]);
  expect(result.confirmed).toBe(3);
  // Each missing name was asked about before deciding.
  expect(result.requests).toBe(3);
  expect((await rowOf(a.id)).status).toBe("active");
  expect((await rowOf(b.id)).status).toBe("active");
});

test("requests are paced: a pause before every request after the first", async () => {
  const tmp = fakeTruckersMp();
  const first = await vtcCompany(tmp);
  const second = await vtcCompany(tmp);
  const gone = await first.member();
  await reset(db, first.company.id);
  await reset(db, second.company.id);
  tmp.leave(gone.steamId64);

  const result = await run(tmp, { paceMs: 2_000 });
  expect(result.requests).toBe(3);
  expect(result.sleeps).toEqual([2_000, 2_000]);
  expect(tmp.calls).toHaveLength(3);
});

test("an outage or a rate limit changes nothing", async () => {
  const tmp = fakeTruckersMp();
  const first = await vtcCompany(tmp);
  const second = await vtcCompany(tmp);
  const gone = await first.member();
  const alsoGone = await second.member();
  await reset(db, first.company.id);
  await reset(db, second.company.id);
  tmp.leave(gone.steamId64);
  tmp.leave(alsoGone.steamId64);

  tmp.setOffline(true);
  const offline = await run(tmp);
  expect(offline.failed).toHaveLength(2);
  expect(offline.failed[0]!.reason).toBe("TruckersMP could not be reached");
  expect(offline).toMatchObject({ confirmed: 0, deactivated: [], rateLimited: false });
  tmp.setOffline(false);

  // Rate limited on the first company: stop, and leave the second for later.
  const [checkedFirst] = [first, second].sort((x, y) => (x.company.id < y.company.id ? -1 : 1));
  tmp.broken.set(`/vtc/${checkedFirst!.vtc.id}/members`, 429);
  const limited = await run(tmp);
  expect(limited).toMatchObject({ rateLimited: true, requests: 1, companies: 0 });
  expect(summarise(limited)).toContain("Rate limited");

  // Rate limited while double-checking a missing member: they stay as they are.
  tmp.broken.clear();
  tmp.broken.set(`/player/${gone.steamId64}`, 429);
  tmp.broken.set(`/player/${alsoGone.steamId64}`, 429);
  const half = await run(tmp);
  expect(half.rateLimited).toBe(true);
  expect(half.deactivated).toEqual([]);

  for (const d of [gone, alsoGone]) {
    expect(await rowOf(d.id)).toMatchObject({ status: "active", leftAt: null });
  }
  // Nobody who wasn't confirmed got a check time, so they are still due.
  expect((await rowOf(gone.id)).lastVtcCheckAt).toBeNull();

  // Back to normal: the next run finishes the job.
  tmp.broken.clear();
  const after = await run(tmp);
  expect(after.deactivated).toHaveLength(2);
});

test("a VTC that is gone, or an empty list, never empties a company", async () => {
  const tmp = fakeTruckersMp();
  const { company, owner, vtc, member } = await vtcCompany(tmp);
  const a = await member();
  await reset(db, company.id);

  tmp.vtcs.delete(vtc.id);
  const gone = await run(tmp);
  expect(gone.failed).toEqual([{ company: company.name, reason: "TruckersMP has no such VTC" }]);
  expect(gone.deactivated).toEqual([]);

  tmp.vtcs.set(vtc.id, vtc);
  tmp.shortLists.set(vtc.id, 0);
  const empty = await run(tmp);
  expect(empty.failed[0]!.reason).toBe("TruckersMP returned an empty member list");
  for (const d of [owner, a]) {
    expect(await rowOf(d.id)).toMatchObject({ status: "active", lastVtcCheckAt: null });
  }
});

test("the owner is never made inactive, only reported", async () => {
  const tmp = fakeTruckersMp();
  const { company, owner, vtc, member } = await vtcCompany(tmp);
  const a = await member();
  await reset(db, company.id);
  // The owner hands the VTC over on TruckersMP and leaves it.
  tmp.vtcs.set(vtc.id, { ...vtc, ownerSteam: a.steamId64 });
  tmp.leave(owner.steamId64);

  const result = await run(tmp);
  expect(result.ownersNotInVtc).toEqual([{ company: company.name, driver: owner.displayName }]);
  expect(result.deactivated).toEqual([]);
  expect(await rowOf(owner.id)).toMatchObject({
    status: "active",
    role: "owner",
    lastVtcCheckAt: NIGHT,
  });
  expect(summarise(result)).toContain("Owners no longer in their own VTC");
});

test("only what is due is checked: companies without a VTC, inactive rows and recent checks are skipped", async () => {
  const tmp = fakeTruckersMp();
  const noVtc = await makeCompany(db);
  await makeDriver(db, { companyId: noVtc.id });
  const { company, vtc, member } = await vtcCompany(tmp);
  const checkedRecently = await member();
  const due = await member();
  const alreadyLeft = await member();
  const noSteam = await makeDriver(db, { companyId: company.id });
  await reset(db, company.id);
  const row = async (driverId: string) => (await rowOf(driverId)).id;
  await db.membership.update({
    where: { id: await row(checkedRecently.id) },
    data: { lastVtcCheckAt: new Date(NIGHT.getTime() - 2 * HOUR) },
  });
  await db.membership.update({
    where: { id: await row(alreadyLeft.id) },
    data: { status: "left", leftAt: new Date(NIGHT.getTime() - 48 * HOUR) },
  });
  tmp.leave(alreadyLeft.steamId64);

  const result = await run(tmp);
  // The owner and `due`; not the one checked two hours ago.
  expect(result).toMatchObject({ companies: 1, confirmed: 2, requests: 1 });
  // At least ours (other test files share this database).
  expect(result.unverifiable).toBeGreaterThanOrEqual(1);
  expect(result.deactivated).toEqual([]);
  expect(tmp.calls).toEqual([`/vtc/${vtc.id}/members`]);
  expect((await rowOf(due.id)).lastVtcCheckAt).toEqual(NIGHT);
  expect((await rowOf(checkedRecently.id)).lastVtcCheckAt).toEqual(
    new Date(NIGHT.getTime() - 2 * HOUR),
  );
  expect(await rowOf(alreadyLeft.id)).toMatchObject({ status: "left", lastVtcCheckAt: null });
  expect((await rowOf(noSteam.id)).lastVtcCheckAt).toBeNull();

  // The same night again: nothing is due, so TruckersMP isn't asked anything.
  // (The driver without Steam is counted, but never makes a run "due".)
  const again = await run(tmp);
  expect(again).toMatchObject({ companies: 0, requests: 0, confirmed: 0 });
  expect(again.unverifiable).toBe(result.unverifiable);

  // The next night everyone is due again; `minAgeMs: 0` forces it at any time.
  const forced = await run(tmp, { minAgeMs: 0 });
  expect(forced.confirmed).toBe(3);
});

test("a dry run reports what would change and writes nothing", async () => {
  const tmp = fakeTruckersMp();
  const { company, member } = await vtcCompany(tmp);
  const gone = await member();
  await reset(db, company.id);
  tmp.leave(gone.steamId64);

  const result = await run(tmp, { dryRun: true });
  expect(result.deactivated).toEqual([{ company: company.name, driver: gone.displayName }]);
  expect(await rowOf(gone.id)).toMatchObject({ status: "active", lastVtcCheckAt: null });
});

test("schedule: one timer per process, no overlapping runs, errors don't stop it", async () => {
  const ticks: (() => void)[] = [];
  const cleared: unknown[] = [];
  const timers = {
    setInterval: (fn: () => void, ms: number) => {
      expect(ms).toBe(HOUR);
      ticks.push(fn);
      return { id: ticks.length, unref: () => undefined };
    },
    clearInterval: (handle: never) => void cleared.push(handle),
  };
  const lines: string[] = [];
  const result = (requests: number): MembershipCheckResult => ({
    companies: 1,
    confirmed: 4,
    deactivated: [],
    ownersNotInVtc: [],
    unverifiable: 0,
    failed: [],
    rateLimited: false,
    requests,
  });
  let release: (r: MembershipCheckResult) => void = () => undefined;
  let runs = 0;
  const runCheck = () => {
    runs++;
    if (runs === 3) throw new Error("database is down");
    return new Promise<MembershipCheckResult>((resolve) => (release = resolve));
  };
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  const stop = startMembershipSchedule(db, { run: runCheck, log: (l) => lines.push(l), timers });
  // Started twice (a hot reload, a second import): still one timer.
  expect(startMembershipSchedule(db, { run: runCheck, timers })).toBe(stop);
  expect(ticks).toHaveLength(1);
  // Nothing runs at start-up; the first check is one interval later.
  expect(runs).toBe(0);

  ticks[0]!();
  ticks[0]!(); // The next tick comes while the first run is still going.
  await flush();
  expect(runs).toBe(1);
  release(result(3));
  await flush();
  expect(lines).toHaveLength(1);
  expect(lines[0]).toBe(
    "Membership check: 1 company, 3 TruckersMP requests. 4 confirmed, 0 left their VTC.",
  );

  // A tick with nothing due is silent.
  ticks[0]!();
  await flush();
  release(result(0));
  await flush();
  expect(lines).toHaveLength(1);

  // A failing run is logged and the schedule goes on.
  ticks[0]!();
  await flush();
  expect(lines[1]).toBe("Membership check failed: database is down");
  ticks[0]!();
  await flush();
  expect(runs).toBe(4);
  release(result(0));

  stop();
  expect(cleared).toMatchObject([{ id: 1 }]);
  // Stopped, so it can be started again.
  const stopAgain = startMembershipSchedule(db, { run: runCheck, timers });
  expect(ticks).toHaveLength(2);
  stopAgain();
});
