// `rank_roles_sync`: written once, in the same transaction as the change that
// makes a member's Discord rank roles wrong, and not written when nothing changed.
import { beforeEach, expect, test } from "bun:test";

import { clearCache } from "@te-rebrand/truckersmp";

import { acceptApplication } from "./applications";
import { createCompany } from "./companies";
import { checkMemberships } from "./membership-check";
import { OutboxPayloadSchema, type RoleSyncReason } from "./outbox";
import { appRouter } from "./routers/index";
import { makeCompany, makeDriver, makeJob, outbox, testDb } from "./test-db";
import { fakeTruckersMp, linkSteam } from "./test-truckersmp";

const db = await testDb();
beforeEach(clearCache);

// A switch for the "same transaction" tests: while a driver's name starts with
// "refuse-outbox", the database refuses outbox rows about them. If the change
// and its outbox row are one transaction, the change is undone too.
await db.$executeRawUnsafe(`
  CREATE OR REPLACE FUNCTION test_refuse_outbox() RETURNS trigger AS $$
  BEGIN
    IF NEW.payload->>'driverName' LIKE 'refuse-outbox%' THEN
      RAISE EXCEPTION 'outbox refused (test)';
    END IF;
    RETURN NEW;
  END $$ LANGUAGE plpgsql`);
await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_refuse_outbox ON outbox_event`);
await db.$executeRawUnsafe(`
  CREATE TRIGGER test_refuse_outbox BEFORE INSERT ON outbox_event
  FOR EACH ROW EXECUTE FUNCTION test_refuse_outbox()`);
const refuseOutboxFor = (driverId: string) =>
  db.driver.update({ where: { id: driverId }, data: { displayName: `refuse-outbox-${driverId}` } });

const NOW = new Date("2026-11-13T10:00:00Z");
const ROLE = {
  rookie: "400000000000000001",
  pro: "400000000000000002",
  elite: "400000000000000003",
  other: "400000000000000004",
};

/** The role syncs waiting for a company, oldest first. Each must be a valid payload. */
async function syncs(companyId: string) {
  const rows = await outbox(db, companyId);
  return rows.flatMap((row) => {
    if (row.type !== "rank_roles_sync") return [];
    const payload = OutboxPayloadSchema.parse(row);
    if (payload.type !== "rank_roles_sync") return [];
    const { driverId, reason, retiredRoleIds } = payload;
    return [{ driverId, reason, retiredRoleIds }];
  });
}
const sync = (driverId: string, reason: RoleSyncReason, retiredRoleIds: string[] = []) => ({
  driverId,
  reason,
  retiredRoleIds,
});
const statusOf = async (driverId: string, companyId: string) =>
  (await db.membership.findFirstOrThrow({ where: { driverId, companyId } })).status;
const pendingApplication = (companyId: string, driverId: string) =>
  db.application.create({ data: { companyId, driverId, status: "pending", answers: [] } });

// ---- joining ----------------------------------------------------------------

test("accepting an application asks for the new member's roles, once", async () => {
  const company = await makeCompany(db, [{ name: "Rookie", minKm: 0, discordRoleId: ROLE.rookie }]);
  const applicant = await makeDriver(db);
  const application = await pendingApplication(company.id, applicant.id);

  await acceptApplication(db, { companyId: company.id, applicationId: application.id });

  expect(await syncs(company.id)).toEqual([sync(applicant.id, "joined")]);
  const [row] = await outbox(db, company.id);
  expect(row).toMatchObject({ type: "rank_roles_sync", driverName: applicant.displayName });

  // Accepting again is refused and writes nothing more.
  await expect(
    acceptApplication(db, { companyId: company.id, applicationId: application.id }),
  ).rejects.toThrow("no longer open");
  expect(await syncs(company.id)).toHaveLength(1);
});

test("an accept that is refused writes nothing", async () => {
  const [company, elsewhere] = [await makeCompany(db), await makeCompany(db)];
  const taken = await makeDriver(db, { companyId: elsewhere.id });
  const application = await pendingApplication(company.id, taken.id);

  await expect(
    acceptApplication(db, { companyId: company.id, applicationId: application.id }),
  ).rejects.toThrow("already in");
  expect(await syncs(company.id)).toEqual([]);
  expect(await syncs(elsewhere.id)).toEqual([]);
});

test("accept: the membership and the sync are one transaction", async () => {
  const company = await makeCompany(db);
  const applicant = await makeDriver(db);
  const application = await pendingApplication(company.id, applicant.id);
  await refuseOutboxFor(applicant.id);

  await expect(
    acceptApplication(db, { companyId: company.id, applicationId: application.id }),
  ).rejects.toThrow();
  expect(await db.membership.count({ where: { driverId: applicant.id } })).toBe(0);
  expect((await db.application.findUniqueOrThrow({ where: { id: application.id } })).status).toBe(
    "pending",
  );
});

test("registering a company asks for the owner's roles, once, in the same transaction", async () => {
  const tmp = fakeTruckersMp();
  const owner = await linkSteam(db, await makeDriver(db));
  const vtc = tmp.addVtc("Sync Freight", owner.steamId64);

  const company = await createCompany(db, owner, { vtcId: vtc.id }, { ...tmp, now: NOW });
  expect(await syncs(company.id)).toEqual([sync(owner.id, "joined")]);

  const refused = await linkSteam(db, await makeDriver(db));
  const other = tmp.addVtc("Refused Freight", refused.steamId64);
  await refuseOutboxFor(refused.id);
  const stored = await db.driver.findUniqueOrThrow({ where: { id: refused.id } });
  await expect(
    createCompany(db, stored, { vtcId: other.id }, { ...tmp, now: NOW }),
  ).rejects.toThrow();
  expect(await db.company.count({ where: { truckersmpVtcId: other.id } })).toBe(0);
  expect(await db.membership.count({ where: { driverId: refused.id } })).toBe(0);
});

// ---- leaving ----------------------------------------------------------------

test("leaving asks for a sync once; a second try writes nothing", async () => {
  const company = await makeCompany(db);
  const driver = await makeDriver(db, { companyId: company.id });
  const api = appRouter.createCaller(driver.ctx);

  await api.memberships.leave({ companyId: company.id });
  expect(await statusOf(driver.id, company.id)).toBe("left");
  expect(await syncs(company.id)).toEqual([sync(driver.id, "left")]);

  await expect(api.memberships.leave({ companyId: company.id })).rejects.toThrow();
  expect(await syncs(company.id)).toHaveLength(1);
});

test("the owner cannot leave, and nothing is written", async () => {
  const company = await makeCompany(db);
  const owner = await makeDriver(db, { companyId: company.id, role: "owner" });
  await expect(
    appRouter.createCaller(owner.ctx).memberships.leave({ companyId: company.id }),
  ).rejects.toThrow();
  expect(await syncs(company.id)).toEqual([]);
});

test("leave: the membership and the sync are one transaction", async () => {
  const company = await makeCompany(db);
  const driver = await makeDriver(db, { companyId: company.id });
  await refuseOutboxFor(driver.id);

  await expect(
    appRouter.createCaller(driver.ctx).memberships.leave({ companyId: company.id }),
  ).rejects.toThrow();
  expect(await statusOf(driver.id, company.id)).toBe("active");
});

test("removing a member asks for a sync of that member, once, in the same transaction", async () => {
  const company = await makeCompany(db);
  const manager = await makeDriver(db, { companyId: company.id, role: "manager" });
  const [driver, kept] = [
    await makeDriver(db, { companyId: company.id }),
    await makeDriver(db, { companyId: company.id }),
  ];
  const api = appRouter.createCaller(manager.ctx);
  const membershipOf = (driverId: string) =>
    db.membership.findFirstOrThrow({ where: { driverId, companyId: company.id } });
  const remove = async (driverId: string) =>
    api.memberships.remove({
      companyId: company.id,
      membershipId: (await membershipOf(driverId)).id,
    });

  await remove(driver.id);
  expect(await statusOf(driver.id, company.id)).toBe("removed");
  expect(await syncs(company.id)).toEqual([sync(driver.id, "removed")]);

  // Already gone, and a manager may not remove a manager: nothing more is written.
  await expect(remove(driver.id)).rejects.toThrow("isn't here");
  await expect(remove(manager.id)).rejects.toThrow();
  expect(await syncs(company.id)).toHaveLength(1);

  await refuseOutboxFor(kept.id);
  await expect(remove(kept.id)).rejects.toThrow();
  expect(await statusOf(kept.id, company.id)).toBe("active");
});

test("the nightly check asks for a sync of each member it sets inactive, and of nobody else", async () => {
  // Only this test's company is due (see membership-check.test.ts).
  await db.membership.updateMany({ data: { lastVtcCheckAt: new Date("2030-01-01T00:00:00Z") } });
  const tmp = fakeTruckersMp();
  const company = await makeCompany(db);
  const owner = await linkSteam(db, await makeDriver(db, { companyId: company.id, role: "owner" }));
  const vtc = tmp.addVtc(company.name, owner.steamId64);
  await db.company.update({ where: { id: company.id }, data: { truckersmpVtcId: vtc.id } });
  const member = async () => {
    const driver = await linkSteam(db, await makeDriver(db, { companyId: company.id }));
    tmp.join(driver.steamId64, vtc.id);
    return driver;
  };
  const [stays, goes, stuck] = [await member(), await member(), await member()];
  const due = () =>
    db.membership.updateMany({ where: { companyId: company.id }, data: { lastVtcCheckAt: null } });
  const run = (dryRun = false) =>
    checkMemberships(db, {
      fetchImpl: tmp.fetchImpl,
      now: () => NOW,
      sleep: async () => undefined,
      dryRun,
    });

  // Everyone is still in the VTC: nothing changes, nothing is written.
  await due();
  await run();
  expect(await syncs(company.id)).toEqual([]);

  tmp.leave(goes.steamId64);
  await due();
  await run(true); // a dry run reports and writes nothing
  expect(await syncs(company.id)).toEqual([]);

  await run();
  expect(await statusOf(goes.id, company.id)).toBe("inactive");
  expect(await statusOf(stays.id, company.id)).toBe("active");
  expect(await syncs(company.id)).toEqual([sync(goes.id, "inactive")]);

  // Run again: they are not active any more, so not looked at and not synced twice.
  await due();
  await run();
  expect(await syncs(company.id)).toHaveLength(1);

  // Same transaction: if the sync cannot be written, the member stays active.
  tmp.leave(stuck.steamId64);
  await refuseOutboxFor(stuck.id);
  await due();
  await expect(run()).rejects.toThrow();
  expect(await statusOf(stuck.id, company.id)).toBe("active");
});

// ---- changes to the ladder ---------------------------------------------------

/**
 * Rookie from 0 km (a role), Pro from 1 000 km (a role), Elite from 5 000 km
 * (no role). One member at each rank, and someone who left while a Pro.
 */
async function ladder() {
  const company = await makeCompany(db, [
    { name: "Rookie", minKm: 0, discordRoleId: ROLE.rookie },
    { name: "Pro", minKm: 1000, discordRoleId: ROLE.pro },
    { name: "Elite", minKm: 5000 },
  ]);
  const manager = await makeDriver(db, { companyId: company.id, role: "manager" });
  const member = async (km: number) => {
    const driver = await makeDriver(db, { companyId: company.id });
    if (km > 0) await makeJob(db, { driverId: driver.id, companyId: company.id, drivenKm: km });
    return driver;
  };
  const [rookie, pro, elite, gone] = [
    await member(0),
    await member(1500),
    await member(6000),
    await member(1500),
  ];
  await db.membership.updateMany({ where: { driverId: gone.id }, data: { status: "left" } });
  const [rookieRank, proRank, eliteRank] = company.ranks;
  const api = appRouter.createCaller(manager.ctx).admin.ranks;
  return {
    companyId: company.id,
    api,
    manager,
    rookie,
    pro,
    elite,
    ranks: { rookie: rookieRank!, pro: proRank!, elite: eliteRank! },
  };
}

test("a rank edit that moves nobody to another role writes nothing", async () => {
  const { companyId, api, ranks } = await ladder();

  // A new name.
  await api.update({
    companyId,
    rankId: ranks.pro.id,
    name: "Professional",
    minKm: 1000,
    discordRoleId: ROLE.pro,
  });
  // A new distance that nobody sits between (the Pro has 1 500 km).
  await api.update({
    companyId,
    rankId: ranks.pro.id,
    name: "Professional",
    minKm: 1200,
    discordRoleId: ROLE.pro,
  });
  // Saved again unchanged.
  await api.update({
    companyId,
    rankId: ranks.pro.id,
    name: "Professional",
    minKm: 1200,
    discordRoleId: ROLE.pro,
  });
  // A new rank without a role, above everyone who holds a role.
  await api.create({ companyId, name: "Legend", minKm: 50_000, discordRoleId: null });

  expect(await syncs(companyId)).toEqual([]);
});

test("a new distance: only the members it moves, one row each", async () => {
  const { companyId, api, ranks, pro } = await ladder();

  await api.update({
    companyId,
    rankId: ranks.pro.id,
    name: "Pro",
    minKm: 2000,
    discordRoleId: ROLE.pro,
  });

  // The Pro (1 500 km) is a Rookie now. The Rookie and the Elite keep their roles;
  // the driver who left is nobody's to sync.
  expect(await syncs(companyId)).toEqual([sync(pro.id, "ranks_changed")]);
});

test("a new role on a rank: the members holding that rank, with the old role to take", async () => {
  const { companyId, api, ranks, pro, elite } = await ladder();

  await api.update({
    companyId,
    rankId: ranks.pro.id,
    name: "Pro",
    minKm: 1000,
    discordRoleId: ROLE.other,
  });
  expect(await syncs(companyId)).toEqual([sync(pro.id, "ranks_changed", [ROLE.pro])]);

  // A rank that had no role gets one: its holders, and nothing to take.
  await api.update({
    companyId,
    rankId: ranks.elite.id,
    name: "Elite",
    minKm: 5000,
    discordRoleId: ROLE.elite,
  });
  expect((await syncs(companyId)).slice(1)).toEqual([sync(elite.id, "ranks_changed")]);
});

test("a deleted rank: its holders drop to the rank below, and its role is taken", async () => {
  const { companyId, api, ranks, pro, elite } = await ladder();

  await api.delete({ companyId, rankId: ranks.pro.id });
  expect(await syncs(companyId)).toEqual([sync(pro.id, "ranks_changed", [ROLE.pro])]);

  // Elite has no role, but its holder drops to Rookie, which has one.
  await api.delete({ companyId, rankId: ranks.elite.id });
  expect((await syncs(companyId)).slice(1)).toEqual([sync(elite.id, "ranks_changed")]);
});

test("a new rank with a role: the members already past its distance", async () => {
  const { companyId, api, pro } = await ladder();

  await api.create({ companyId, name: "Senior", minKm: 1400, discordRoleId: ROLE.other });
  expect(await syncs(companyId)).toEqual([sync(pro.id, "ranks_changed")]);
});

test("a ladder without Discord roles never writes a sync", async () => {
  const company = await makeCompany(db, [
    { name: "Rookie", minKm: 0 },
    { name: "Pro", minKm: 1000 },
  ]);
  const manager = await makeDriver(db, { companyId: company.id, role: "manager" });
  await makeJob(db, { driverId: manager.id, companyId: company.id, drivenKm: 1500 });
  const api = appRouter.createCaller(manager.ctx).admin.ranks;
  const companyId = company.id;

  await api.update({
    companyId,
    rankId: company.ranks[1]!.id,
    name: "Pro",
    minKm: 2000,
    discordRoleId: null,
  });
  await api.delete({ companyId, rankId: company.ranks[1]!.id });
  await api.create({ companyId, name: "Pro", minKm: 500, discordRoleId: null });

  expect(await syncs(companyId)).toEqual([]);
});

test("a refused rank change writes nothing, and a change is undone if its syncs cannot be written", async () => {
  const { companyId, api, ranks, pro } = await ladder();

  await expect(
    api.update({
      companyId,
      rankId: ranks.pro.id,
      name: "Rookie",
      minKm: 3000,
      discordRoleId: null,
    }),
  ).rejects.toThrow("already a rank called Rookie");
  await expect(api.delete({ companyId, rankId: "no-such-rank" })).rejects.toThrow("gone");
  expect(await syncs(companyId)).toEqual([]);

  await refuseOutboxFor(pro.id);
  await expect(api.delete({ companyId, rankId: ranks.pro.id })).rejects.toThrow();
  await expect(
    api.update({
      companyId,
      rankId: ranks.pro.id,
      name: "Pro",
      minKm: 1000,
      discordRoleId: ROLE.other,
    }),
  ).rejects.toThrow();
  expect(await db.rank.findUniqueOrThrow({ where: { id: ranks.pro.id } })).toMatchObject({
    minKm: 1000,
    discordRoleId: ROLE.pro,
  });
  expect(await syncs(companyId)).toEqual([]);
});

test("a big company: one row per moved member, none for the rest", async () => {
  const company = await makeCompany(db, [
    { name: "Rookie", minKm: 0, discordRoleId: ROLE.rookie },
    { name: "Pro", minKm: 1000, discordRoleId: ROLE.pro },
  ]);
  const manager = await makeDriver(db, { companyId: company.id, role: "manager" });
  // 2 300 members: 1 150 with 1 500 km (they move), 1 150 with none (they do not).
  const ids = Array.from({ length: 2300 }, (_, i) => `${company.id}-m${i}`);
  await db.user.createMany({
    data: ids.map((id) => ({ id, name: id, email: `${id}@example.test` })),
  });
  await db.driver.createMany({ data: ids.map((id) => ({ id, userId: id, displayName: id })) });
  await db.membership.createMany({
    data: ids.map((id) => ({ companyId: company.id, driverId: id })),
  });
  const finishedAt = new Date();
  await db.job.createMany({
    data: ids
      .filter((_, i) => i % 2 === 0)
      .map((id) => ({
        driverId: id,
        companyId: company.id,
        clientJobId: `job-${id}`,
        game: "ets2" as const,
        sourceCity: "Hamburg",
        sourceCompany: "A",
        destCity: "Lyon",
        destCompany: "B",
        cargo: "Electronics",
        cargoMassKg: 1000,
        plannedKm: 1500,
        drivenKm: 1500,
        odometerStart: 0,
        odometerEnd: 1500,
        income: 1000,
        damagePct: 0,
        maxSpeedKmh: 90,
        startedAt: finishedAt,
        finishedAt,
        status: "delivered" as const,
      })),
  });

  await appRouter.createCaller(manager.ctx).admin.ranks.update({
    companyId: company.id,
    rankId: company.ranks[1]!.id,
    name: "Pro",
    minKm: 2000,
    discordRoleId: ROLE.pro,
  });

  const written = await syncs(company.id);
  expect(written).toHaveLength(1150);
  expect(new Set(written.map((w) => w.driverId)).size).toBe(1150);
  expect(written.every((w) => ids.indexOf(w.driverId) % 2 === 0)).toBe(true);
});

// ---- another Discord server ---------------------------------------------------

test("a new Discord server asks for a sync of every active member; saving it again does not", async () => {
  const { companyId, manager, rookie, pro, elite } = await ladder();
  const owner = await makeDriver(db, { companyId, role: "owner" });
  const api = appRouter.createCaller(owner.ctx).admin.settings;
  const settings = {
    companyId,
    name: "Sync Haulage",
    tag: null,
    logoUrl: null,
    about: "",
    discordGuildId: "200000000000000001",
    discord: {
      deliveryChannelId: null,
      rankUpChannelId: null,
      eventChannelId: null,
      monthlyChannelId: null,
    },
  };

  await api.update(settings);
  const everyone = [manager, rookie, pro, elite, owner].map((d) => d.id).sort();
  expect((await syncs(companyId)).map((s) => s.driverId).sort()).toEqual(everyone);
  expect((await syncs(companyId)).every((s) => s.reason === "server_changed")).toBe(true);

  // The same server, another name: nothing. No server at all: nothing.
  await api.update({ ...settings, name: "Sync Haulage AS" });
  await api.update({ ...settings, discordGuildId: null });
  expect(await syncs(companyId)).toHaveLength(everyone.length);
});

test("a new Discord server for a company without rank roles writes nothing", async () => {
  const company = await makeCompany(db, [{ name: "Rookie", minKm: 0 }]);
  const owner = await makeDriver(db, { companyId: company.id, role: "owner" });
  await appRouter.createCaller(owner.ctx).admin.settings.update({
    companyId: company.id,
    name: "No Roles Ltd",
    tag: null,
    logoUrl: null,
    about: "",
    discordGuildId: "200000000000000002",
    discord: {
      deliveryChannelId: null,
      rankUpChannelId: null,
      eventChannelId: null,
      monthlyChannelId: null,
    },
  });
  expect(await syncs(company.id)).toEqual([]);
});

// ---- what the bot last found ---------------------------------------------------

test("bot status: a manager reads their own company's, and a check of an old server is not shown", async () => {
  const company = await makeCompany(db);
  const manager = await makeDriver(db, { companyId: company.id, role: "manager" });
  const api = appRouter.createCaller(manager.ctx).admin.settings;
  const companyId = company.id;

  expect(await api.botStatus({ companyId })).toEqual({
    guildId: null,
    server: null,
    lastProblem: null,
  });

  const guildId = "200000000000000003";
  await db.company.update({ where: { id: companyId }, data: { discordGuildId: guildId } });
  // Set, but the bot has not looked yet.
  expect(await api.botStatus({ companyId })).toEqual({ guildId, server: null, lastProblem: null });

  await db.botStatus.create({
    data: {
      companyId,
      guildId,
      guildOk: false,
      guildReason: "The bot is not in the Discord server. Invite it there first.",
      checkedAt: NOW,
      lastProblem: "The bot lacks SendMessages in the channel #deliveries.",
      lastProblemAt: NOW,
    },
  });
  expect(await api.botStatus({ companyId })).toEqual({
    guildId,
    server: {
      ok: false,
      reason: "The bot is not in the Discord server. Invite it there first.",
      checkedAt: NOW,
    },
    lastProblem: { text: "The bot lacks SendMessages in the channel #deliveries.", at: NOW },
  });

  // The company moves to another server: the old check says nothing about it.
  await db.company.update({
    where: { id: companyId },
    data: { discordGuildId: "200000000000000004" },
  });
  expect((await api.botStatus({ companyId })).server).toBeNull();

  // Another company's manager gets nothing, and their own status is separate.
  const other = await makeCompany(db);
  const stranger = await makeDriver(db, { companyId: other.id, role: "manager" });
  const theirs = appRouter.createCaller(stranger.ctx).admin.settings;
  await expect(theirs.botStatus({ companyId })).rejects.toThrow("Not allowed in this company");
  expect(await theirs.botStatus({ companyId: other.id })).toEqual({
    guildId: null,
    server: null,
    lastProblem: null,
  });
});
