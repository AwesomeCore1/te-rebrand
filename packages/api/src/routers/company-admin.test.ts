// Who may do what in the admin procedures, and that one company never
// reaches another's rows. Roles are checked by `companyProcedure` alone.
import { expect, test } from "bun:test";

import type { Database } from "@te-rebrand/db";

import type { Context } from "../context";
import { makeCompany, makeDriver, makeJob, outbox, testDb } from "../test-db";
import { companyAdminRouter } from "./company-admin";
import { leaderboardsRouter } from "./leaderboards";

const admin = (ctx: Context) => companyAdminRouter.createCaller(ctx);
const FORBIDDEN = "Not allowed in this company";
const ROLE = "100000000000000001";
const GOAL = {
  title: "100 000 km together",
  metric: "km" as const,
  target: 100_000,
  startAt: new Date("2026-11-01T00:00:00Z"),
  endAt: new Date("2026-11-30T23:59:59.999Z"),
};
const SETTINGS = {
  name: "Renamed Haulage",
  tag: "RH",
  logoUrl: "https://example.test/logo.png",
  about: "We drive **north**.",
  discordGuildId: "200000000000000001",
  discord: {
    deliveryChannelId: "300000000000000001",
    rankUpChannelId: "300000000000000002",
    eventChannelId: null,
    monthlyChannelId: null,
  },
};

/** A company with a rank, a goal and a flagged job, and one person per role. */
async function setup(db: Database) {
  const company = await makeCompany(db, [{ name: "Rookie", minKm: 0 }]);
  const [owner, manager, driver] = await Promise.all([
    makeDriver(db, { companyId: company.id, role: "owner" }),
    makeDriver(db, { companyId: company.id, role: "manager" }),
    makeDriver(db, { companyId: company.id, role: "driver" }),
  ]);
  const goal = await db.goal.create({ data: { ...GOAL, companyId: company.id } });
  const flagged = await makeJob(db, {
    driverId: driver.id,
    companyId: company.id,
    drivenKm: 800,
    status: "flagged",
    flagReasons: ["avg_speed"],
  });
  return { company, owner, manager, driver, goal, flagged, rank: company.ranks[0]! };
}

/** Every admin procedure, called for `target` with ids that belong to `target`. */
function everyCall(ctx: Context, target: Awaited<ReturnType<typeof setup>>) {
  const companyId = target.company.id;
  const api = admin(ctx);
  return {
    "ranks.list": () => api.ranks.list({ companyId }),
    "ranks.create": () => api.ranks.create({ companyId, name: "X", minKm: 1, discordRoleId: null }),
    "ranks.update": () =>
      api.ranks.update({
        companyId,
        rankId: target.rank.id,
        name: "Y",
        minKm: 2,
        discordRoleId: null,
      }),
    "ranks.delete": () => api.ranks.delete({ companyId, rankId: target.rank.id }),
    "goals.list": () => api.goals.list({ companyId }),
    "goals.create": () => api.goals.create({ companyId, ...GOAL }),
    "goals.update": () => api.goals.update({ companyId, goalId: target.goal.id, ...GOAL }),
    "goals.delete": () => api.goals.delete({ companyId, goalId: target.goal.id }),
    "jobs.flagged": () => api.jobs.flagged({ companyId }),
    "jobs.flaggedCount": () => api.jobs.flaggedCount({ companyId }),
    "jobs.approve": () => api.jobs.approve({ companyId, jobId: target.flagged.id }),
    "jobs.reject": () => api.jobs.reject({ companyId, jobId: target.flagged.id }),
    "settings.get": () => api.settings.get({ companyId }),
    "settings.botStatus": () => api.settings.botStatus({ companyId }),
    "settings.update": () => api.settings.update({ companyId, ...SETTINGS }),
  };
}

/** What a company's admin data looks like, to prove nothing changed. */
async function snapshot(db: Database, companyId: string) {
  const [company, ranks, goals, jobs] = await Promise.all([
    db.company.findUniqueOrThrow({ where: { id: companyId } }),
    db.rank.findMany({ where: { companyId }, orderBy: { id: "asc" } }),
    db.goal.findMany({ where: { companyId }, orderBy: { id: "asc" } }),
    db.job.findMany({ where: { companyId }, orderBy: { id: "asc" } }),
  ]);
  return { company, ranks, goals, jobs, outbox: await outbox(db, companyId) };
}

test("a manager or owner of company A cannot read or change company B", async () => {
  const db = await testDb();
  const [a, b] = [await setup(db), await setup(db)];
  const before = await snapshot(db, b.company.id);

  for (const caller of [a.manager, a.owner]) {
    for (const [name, call] of Object.entries(everyCall(caller.ctx, b))) {
      await expect(call(), name).rejects.toThrow(FORBIDDEN);
    }
  }
  expect(await snapshot(db, b.company.id)).toEqual(before);
});

test("a manager cannot reach another company's rows through their own company id", async () => {
  const db = await testDb();
  const [a, b] = [await setup(db), await setup(db)];
  const before = await snapshot(db, b.company.id);
  const api = admin(a.manager.ctx);
  const companyId = a.company.id;

  await expect(
    api.ranks.update({
      companyId,
      rankId: b.rank.id,
      name: "Mine now",
      minKm: 5,
      discordRoleId: null,
    }),
  ).rejects.toThrow("That rank is gone.");
  await expect(api.ranks.delete({ companyId, rankId: b.rank.id })).rejects.toThrow("gone");
  await expect(api.goals.update({ companyId, goalId: b.goal.id, ...GOAL })).rejects.toThrow("gone");
  await expect(api.goals.delete({ companyId, goalId: b.goal.id })).rejects.toThrow("gone");
  await expect(api.jobs.approve({ companyId, jobId: b.flagged.id })).rejects.toThrow(
    "no longer waiting",
  );
  await expect(api.jobs.reject({ companyId, jobId: b.flagged.id })).rejects.toThrow(
    "no longer waiting",
  );
  expect(await snapshot(db, b.company.id)).toEqual(before);
});

test("a plain driver, a former manager and a logged-out visitor are refused everywhere", async () => {
  const db = await testDb();
  const a = await setup(db);
  const before = await snapshot(db, a.company.id);
  const former = await makeDriver(db, { companyId: a.company.id, role: "manager" });
  await db.membership.updateMany({ where: { driverId: former.id }, data: { status: "removed" } });

  for (const caller of [a.driver, former]) {
    for (const [name, call] of Object.entries(everyCall(caller.ctx, a))) {
      await expect(call(), name).rejects.toThrow(FORBIDDEN);
    }
  }
  for (const [name, call] of Object.entries(everyCall({ db, session: null }, a))) {
    await expect(call(), name).rejects.toThrow("Authentication required");
  }
  expect(await snapshot(db, a.company.id)).toEqual(before);
});

test("a manager manages ranks; names and distances stay unique on the ladder", async () => {
  const db = await testDb();
  const { company, manager, driver } = await setup(db);
  const api = admin(manager.ctx);
  const companyId = company.id;

  const created = await api.ranks.create({
    companyId,
    name: " Driver ",
    minKm: 500,
    discordRoleId: ROLE,
  });
  expect(created).toMatchObject({ name: "Driver", minKm: 500, discordRoleId: ROLE, companyId });
  await expect(
    api.ranks.create({ companyId, name: "driver", minKm: 900, discordRoleId: null }),
  ).rejects.toThrow("already a rank called Driver");
  await expect(
    api.ranks.create({ companyId, name: "Other", minKm: 500, discordRoleId: null }),
  ).rejects.toThrow("Driver already starts at 500 km");
  await expect(
    api.ranks.create({ companyId, name: "Bad role", minKm: 700, discordRoleId: "not-an-id" }),
  ).rejects.toThrow();
  await expect(
    api.ranks.create({ companyId, name: "Negative", minKm: -1, discordRoleId: null }),
  ).rejects.toThrow();

  // The driver's flagged 800 km do not count yet, so they hold the 0 km rank.
  await makeJob(db, { driverId: driver.id, companyId, drivenKm: 600 });
  let ladder = await api.ranks.list({ companyId });
  expect(ladder.ranks.map((r) => [r.name, r.minKm, r.members])).toEqual([
    ["Rookie", 0, 2],
    ["Driver", 500, 1],
  ]);

  // Saving a rank unchanged is fine; moving it changes who holds it.
  await api.ranks.update({
    companyId,
    rankId: created.id,
    name: "Driver",
    minKm: 500,
    discordRoleId: ROLE,
  });
  await api.ranks.update({
    companyId,
    rankId: created.id,
    name: "Trucker",
    minKm: 700,
    discordRoleId: null,
  });
  ladder = await api.ranks.list({ companyId });
  expect(ladder.ranks.map((r) => [r.name, r.minKm, r.members, r.discordRoleId])).toEqual([
    ["Rookie", 0, 3, null],
    ["Trucker", 700, 0, null],
  ]);

  await api.ranks.delete({ companyId, rankId: created.id });
  await expect(api.ranks.delete({ companyId, rankId: created.id })).rejects.toThrow("gone");
  expect((await api.ranks.list({ companyId })).ranks.map((r) => r.name)).toEqual(["Rookie"]);
});

test("a manager manages goals; a goal has to end after it starts", async () => {
  const db = await testDb();
  const { company, manager, goal } = await setup(db);
  const api = admin(manager.ctx);
  const companyId = company.id;

  await expect(
    api.goals.create({ companyId, ...GOAL, startAt: GOAL.endAt, endAt: GOAL.startAt }),
  ).rejects.toThrow("end after it starts");
  await expect(api.goals.create({ companyId, ...GOAL, target: 0 })).rejects.toThrow();
  await expect(api.goals.create({ companyId, ...GOAL, title: "  " })).rejects.toThrow();

  // Dates arrive as ISO strings from the browser.
  const created = await api.goals.create({
    companyId,
    title: "500 jobs",
    metric: "jobs",
    target: 500,
    startAt: "2027-01-01T00:00:00.000Z",
    endAt: "2027-01-31T23:59:59.999Z",
  });
  expect(created.startAt).toEqual(new Date("2027-01-01T00:00:00Z"));
  await api.goals.update({
    companyId,
    goalId: goal.id,
    ...GOAL,
    title: "Renamed",
    metric: "income",
  });
  const listed = await api.goals.list({ companyId });
  expect(listed.map((g) => [g.title, g.metric]).sort()).toEqual([
    ["500 jobs", "jobs"],
    ["Renamed", "income"],
  ]);

  await api.goals.delete({ companyId, goalId: created.id });
  expect(await api.goals.list({ companyId })).toHaveLength(1);
});

test("a manager reviews flagged jobs through the API", async () => {
  const db = await testDb();
  const { company, manager, driver, flagged } = await setup(db);
  const api = admin(manager.ctx);
  const companyId = company.id;
  const second = await makeJob(db, {
    driverId: driver.id,
    companyId,
    drivenKm: 300,
    status: "flagged",
  });

  const queue = await api.jobs.flagged({ companyId });
  expect(queue.map((j) => j.id).sort()).toEqual([flagged.id, second.id].sort());
  expect(queue[0]?.driver.displayName).toBe(driver.displayName);
  expect(await api.jobs.flaggedCount({ companyId })).toBe(2);

  expect(await api.jobs.approve({ companyId, jobId: flagged.id })).toEqual({
    id: flagged.id,
    status: "delivered",
  });
  expect(await api.jobs.reject({ companyId, jobId: second.id })).toEqual({
    id: second.id,
    status: "rejected",
  });
  await expect(api.jobs.approve({ companyId, jobId: second.id })).rejects.toThrow(
    "no longer waiting",
  );

  expect(await api.jobs.flagged({ companyId })).toEqual([]);
  expect((await outbox(db, companyId)).map((e) => e.type)).toEqual(["job_delivered"]);
  const reviewed = await db.job.findUniqueOrThrow({ where: { id: flagged.id } });
  expect(reviewed.reviewedById).toBe(manager.id);
});

test("managers read the settings, only the owner changes them, recruitment is kept", async () => {
  const db = await testDb();
  const { company, owner, manager } = await setup(db);
  const companyId = company.id;
  const recruitment = { open: true, questions: ["Why us?"] };
  await db.company.update({ where: { id: companyId }, data: { settings: { recruitment } } });

  const seen = await admin(manager.ctx).settings.get({ companyId });
  expect(seen).toMatchObject({ name: company.name, about: "", canEdit: false });
  expect(seen).not.toHaveProperty("recruitment");
  await expect(admin(manager.ctx).settings.update({ companyId, ...SETTINGS })).rejects.toThrow(
    FORBIDDEN,
  );

  await admin(owner.ctx).settings.update({ companyId, ...SETTINGS });
  expect(await admin(owner.ctx).settings.get({ companyId })).toEqual({
    ...SETTINGS,
    slug: company.slug,
    canEdit: true,
  });
  const stored = await db.company.findUniqueOrThrow({ where: { id: companyId } });
  expect(stored.settings).toMatchObject({ recruitment, about: SETTINGS.about });

  // Clearing optional fields; bad ids and http logos are refused.
  const cleared = {
    ...SETTINGS,
    tag: null,
    logoUrl: null,
    discordGuildId: null,
    discord: { ...SETTINGS.discord, deliveryChannelId: null },
  };
  await admin(owner.ctx).settings.update({ companyId, ...cleared });
  expect(await admin(owner.ctx).settings.get({ companyId })).toMatchObject({
    tag: null,
    logoUrl: null,
    discordGuildId: null,
  });
  const update = admin(owner.ctx).settings.update;
  await expect(update({ companyId, ...SETTINGS, discordGuildId: "my server" })).rejects.toThrow();
  await expect(
    update({ companyId, ...SETTINGS, logoUrl: "http://example.test/a.png" }),
  ).rejects.toThrow();
  await expect(
    update({ companyId, ...SETTINGS, logoUrl: "javascript:alert(1)" }),
  ).rejects.toThrow();
  await expect(update({ companyId, ...SETTINGS, name: "" })).rejects.toThrow();
});

test("the public leaderboard ranks every driver, with their VTC and the viewer's unit", async () => {
  const db = await testDb();
  const company = await makeCompany(db);
  const [first, second, solo] = await Promise.all([
    makeDriver(db, { companyId: company.id }),
    makeDriver(db, { companyId: company.id }),
    makeDriver(db),
  ]);
  await db.driver.update({ where: { id: solo.id }, data: { unitPreference: "mi" } });
  const now = new Date();
  const longAgo = new Date("2025-01-15T12:00:00Z");
  // Far more than any other test drives, so these three lead the shared board.
  await makeJob(db, {
    driverId: first.id,
    companyId: company.id,
    drivenKm: 9_000_000,
    finishedAt: now,
  });
  await makeJob(db, {
    driverId: second.id,
    companyId: company.id,
    drivenKm: 8_000_000,
    game: "ats",
    finishedAt: now,
  });
  await makeJob(db, { driverId: solo.id, companyId: null, drivenKm: 7_000_000, finishedAt: now });
  await makeJob(db, {
    driverId: solo.id,
    companyId: null,
    drivenKm: 5_000_000,
    finishedAt: longAgo,
  });
  await makeJob(db, {
    driverId: first.id,
    companyId: company.id,
    drivenKm: 50_000_000,
    status: "flagged",
    finishedAt: now,
  });

  const board = (
    ctx: Context,
    input: Parameters<ReturnType<typeof leaderboardsRouter.createCaller>["drivers"]>[0],
  ) => leaderboardsRouter.createCaller(ctx).drivers(input);
  const anonymous = { db, session: null };

  const week = await board(anonymous, { period: "week" });
  expect(week.unit).toBeNull();
  expect(week.you).toBeNull();
  expect(
    week.rows
      .slice(0, 3)
      .map((r) => [r.place, r.driverId, r.km, r.jobs, r.company?.slug ?? null, r.you]),
  ).toEqual([
    [1, first.id, 9_000_000, 1, company.slug, false],
    [2, second.id, 8_000_000, 1, company.slug, false],
    [3, solo.id, 7_000_000, 1, null, false],
  ]);

  // All time adds the old job; the game switch keeps only that game's km.
  const all = await board(anonymous, { period: "all" });
  expect(all.rows.slice(0, 2).map((r) => [r.driverId, r.km, r.jobs])).toEqual([
    [solo.id, 12_000_000, 2],
    [first.id, 9_000_000, 1],
  ]);
  const ats = await board(anonymous, { period: "month", game: "ats" });
  expect(ats.rows[0]?.driverId).toBe(second.id);
  expect(ats.rows.some((r) => r.driverId === first.id)).toBe(false);

  // Logged in: your row is marked, and below the cut you still get your place.
  const mine = await board(solo.ctx, { period: "month" });
  expect(mine.unit).toBe("mi");
  expect(mine.rows.find((r) => r.you)?.driverId).toBe(solo.id);
  expect(mine.you).toBeNull();
  const cut = await board(solo.ctx, { period: "month", limit: 2 });
  expect(cut.rows).toHaveLength(2);
  expect(cut.you).toEqual({ place: 3, km: 7_000_000, jobs: 1 });
  expect(cut.drivers).toBeGreaterThanOrEqual(3);
});
