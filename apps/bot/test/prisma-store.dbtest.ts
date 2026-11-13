// The Store against a real Postgres: the queries and the claims that the
// in-memory fake only imitates. Not part of `bun test`; run it with
//
//   bun run --cwd apps/bot test:db
//
// It uses the database from apps/web/.env. Every row it makes has an id that
// starts with "bottest-" and is removed again, before and after; it reads the
// outbox but only ever changes its own rows.
import { afterAll, beforeAll, expect, test } from "bun:test";

import { updateCompanySettings } from "@te-rebrand/api/company-settings";
import { enqueueOutbox } from "@te-rebrand/api/outbox";
import { createPrismaClient } from "@te-rebrand/db";

import { createBot } from "../src/bot";
import { silentLogger } from "../src/log";
import { prismaStore } from "../src/prisma-store";
import { FakeDiscord } from "./fakes";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is not set. Run this with: bun run --cwd apps/bot test:db");
const db = createPrismaClient({ DATABASE_URL: url });
const store = prismaStore(db);

const COMPANY = "bottest-company";
const OTHER = "bottest-other";
const GUILD = "100000000000000001";

async function clean() {
  // Users take their accounts, drivers, memberships and jobs with them;
  // companies their ranks, outbox rows, bot posts and bot status.
  await db.user.deleteMany({ where: { id: { startsWith: "bottest-" } } });
  await db.company.deleteMany({ where: { id: { startsWith: "bottest-" } } });
}

async function person(
  key: string,
  discordId: string | null,
  role: "owner" | "manager" | "driver",
  status: "active" | "left" = "active",
) {
  await db.user.create({
    data: {
      id: `bottest-user-${key}`,
      name: key,
      email: `bottest-${key}@example.invalid`,
      accounts: discordId
        ? { create: { id: `bottest-account-${key}`, providerId: "discord", accountId: discordId } }
        : undefined,
      driver: {
        create: {
          id: `bottest-driver-${key}`,
          displayName: key,
          memberships: { create: { companyId: COMPANY, role, status } },
        },
      },
    },
  });
}

let jobNumber = 0;
const job = (
  driver: string,
  drivenKm: number,
  finishedAt: string,
  extra: { game?: "ets2" | "ats"; status?: "delivered" | "cancelled"; companyId?: string } = {},
) =>
  db.job.create({
    data: {
      driverId: `bottest-driver-${driver}`,
      companyId: extra.companyId ?? COMPANY,
      clientJobId: `bottest-${++jobNumber}`,
      game: extra.game ?? "ets2",
      sourceCity: "Hamburg",
      sourceCompany: "A",
      destCity: "Lyon",
      destCompany: "B",
      cargo: "Electronics",
      cargoMassKg: 1000,
      plannedKm: drivenKm,
      drivenKm,
      odometerStart: 0,
      odometerEnd: drivenKm,
      income: 100,
      damagePct: 0,
      maxSpeedKmh: 80,
      startedAt: new Date(finishedAt),
      finishedAt: new Date(finishedAt),
      status: extra.status ?? "delivered",
    },
  });

beforeAll(async () => {
  await clean();
  await db.company.create({
    data: {
      id: COMPANY,
      name: "Bot Test Haulage",
      slug: "bottest-company",
      discordGuildId: GUILD,
      truckersmpVtcId: null,
      settings: { discord: { deliveryChannelId: "200000000000000001" }, about: "kept" },
      ranks: {
        create: [
          { name: "Rookie", minKm: 0, discordRoleId: "400000000000000001" },
          { name: "Veteran", minKm: 1000, discordRoleId: "400000000000000002" },
          { name: "No role", minKm: 5000 },
        ],
      },
    },
  });
  await db.company.create({ data: { id: OTHER, name: "Bot Test Other", slug: "bottest-other" } });
  await person("manager", "300000000000000002", "manager");
  await person("owner", "300000000000000001", "owner");
  await person("driver", "300000000000000003", "driver");
  await person("exmanager", "300000000000000004", "manager", "left");
  await person("nodiscord", null, "driver");
});

afterAll(async () => {
  await clean();
  await db.$disconnect();
});

test("a company row carries its Discord settings", async () => {
  expect(await store.company(COMPANY)).toEqual({
    id: COMPANY,
    name: "Bot Test Haulage",
    discordGuildId: GUILD,
    truckersmpVtcId: null,
    verified: false,
    discord: {
      deliveryChannelId: "200000000000000001",
      rankUpChannelId: null,
      eventChannelId: null,
      monthlyChannelId: null,
    },
  });
  expect(await store.company("bottest-nope")).toBeNull();
  const withDiscord = (await store.companiesWithDiscord()).map((c) => c.id);
  expect(withDiscord).toContain(COMPANY);
  expect(withDiscord).not.toContain(OTHER);
});

test("owners and managers by Discord id: active ones only, owners first", async () => {
  expect(await store.managerDiscordIds(COMPANY)).toEqual([
    "300000000000000001",
    "300000000000000002",
  ]);
  expect(await store.managerDiscordIds(OTHER)).toEqual([]);
});

test("a driver's Discord id, and the company's rank roles", async () => {
  expect(await store.driverDiscordId("bottest-driver-driver")).toBe("300000000000000003");
  expect(await store.driverDiscordId("bottest-driver-nodiscord")).toBeNull();
  expect((await store.rankRoleIds(COMPANY)).sort()).toEqual([
    "400000000000000001",
    "400000000000000002",
  ]);
  expect(await store.rankRoleIds(OTHER)).toEqual([]);
});

test("monthly top: delivered jobs of that company in that month only", async () => {
  await job("owner", 1200, "2026-10-03T10:00:00Z");
  await job("owner", 800, "2026-10-31T23:59:59Z");
  await job("driver", 1500, "2026-10-10T10:00:00Z", { game: "ats" });
  await job("driver", 100, "2026-10-11T10:00:00Z");
  await job("manager", 900, "2026-10-12T10:00:00Z");
  await job("nodiscord", 300, "2026-10-12T10:00:00Z");
  await job("nodiscord", 9000, "2026-09-30T23:59:59Z");
  await job("nodiscord", 9000, "2026-11-01T00:00:00Z");
  await job("nodiscord", 9000, "2026-10-05T10:00:00Z", { status: "cancelled" });
  await job("nodiscord", 9000, "2026-10-05T10:00:00Z", { companyId: OTHER });

  const top = await store.monthlyTop(
    COMPANY,
    new Date("2026-10-01T00:00:00Z"),
    new Date("2026-11-01T00:00:00Z"),
    3,
  );

  expect(top).toEqual([
    { driverId: "bottest-driver-owner", driverName: "owner", km: 2000, atsKm: 0, jobs: 2 },
    { driverId: "bottest-driver-driver", driverName: "driver", km: 1600, atsKm: 1500, jobs: 2 },
    { driverId: "bottest-driver-manager", driverName: "manager", km: 900, atsKm: 0, jobs: 1 },
  ]);
});

test("outbox: claim, wait, last try and finish, one winner per claim", async () => {
  const mine = async () =>
    (await store.pendingOutbox(new Date(), 10_000)).filter((r) => r.companyId === COMPANY);
  const first = await db.outboxEvent.create({
    data: {
      companyId: COMPANY,
      type: "job_delivered",
      payload: { type: "job_delivered", n: 1 },
      createdAt: new Date("2026-11-13T10:00:00Z"),
    },
  });
  const second = await db.outboxEvent.create({
    data: {
      companyId: COMPANY,
      type: "rank_up",
      payload: { type: "rank_up", n: 2 },
      createdAt: new Date("2026-11-13T10:00:01Z"),
    },
  });

  // Oldest first, as the API wrote them.
  const pending = await mine();
  expect(pending.map((r) => r.id)).toEqual([first.id, second.id]);
  expect(pending[0]).toMatchObject({ attempts: 0, lastError: null, type: "job_delivered" });
  expect(pending[0]!.payload).toEqual({ type: "job_delivered", n: 1 });

  // Two bots claim the same row at once: exactly one gets it.
  const until = new Date(Date.now() + 120_000);
  const claims = await Promise.all([
    store.claimOutbox(pending[0]!, until),
    store.claimOutbox(pending[0]!, until),
  ]);
  expect(claims.sort()).toEqual([false, true]);
  // A claimed row is hidden until its time.
  expect((await mine()).map((r) => r.id)).toEqual([second.id]);

  // A failed try: visible again once the wait is over, with the reason.
  await store.retryOutbox(first.id, "Discord had a problem (503).", new Date(Date.now() - 1000));
  expect((await mine())[0]).toMatchObject({
    id: first.id,
    attempts: 1,
    lastError: "Discord had a problem (503).",
  });
  await store.retryOutbox(first.id, "again", new Date(Date.now() + 60_000));
  expect((await mine()).map((r) => r.id)).toEqual([second.id]);

  // Finished rows are gone from the queue for good.
  const now = new Date();
  await store.finishOutbox(first.id, now, null);
  expect(await db.outboxEvent.findUnique({ where: { id: first.id } })).toMatchObject({
    processedAt: now,
    lastError: null,
    nextAttemptAt: null,
    attempts: 1,
  });
  expect(await store.claimOutbox({ id: first.id, attempts: 1 }, until)).toBe(false);

  // The last try marks the row processed before anything is sent.
  const stale = { id: second.id, attempts: 0 };
  expect(await store.claimOutboxForLastTry(stale, now, "interrupted")).toBe(true);
  expect(await store.claimOutboxForLastTry(stale, now, "interrupted")).toBe(false);
  await store.noteOutbox(second.id, "interrupted. It failed.");
  expect(await db.outboxEvent.findUnique({ where: { id: second.id } })).toMatchObject({
    processedAt: now,
    attempts: 1,
    lastError: "interrupted. It failed.",
  });
  expect(await mine()).toEqual([]);
});

test("scheduled posts: one claim wins, a failed one can be retaken after its wait", async () => {
  const kind = "monthly_winners";
  const longAgo = new Date(0);
  const claims = await Promise.all(
    Array.from({ length: 5 }, () => store.claimPost(COMPANY, kind, "2026-10", longAgo)),
  );
  expect(claims.filter(Boolean)).toHaveLength(1);
  // The same key for another company is a different post.
  expect(await store.claimPost(OTHER, kind, "2026-10", longAgo)).toBe(true);

  expect(await store.findPosts({ kind, keys: ["2026-10"], companyId: COMPANY })).toMatchObject([
    { companyId: COMPANY, key: "2026-10", status: "pending" },
  ]);
  expect(await store.findPosts({ kind, keys: ["2026-10"] })).toHaveLength(2);

  await store.settlePost(COMPANY, kind, "2026-10", "failed", "Discord had a problem (503).");
  // Too soon to take it again...
  expect(await store.claimPost(COMPANY, kind, "2026-10", longAgo)).toBe(false);
  // ...and once the wait is over, exactly one caller takes it.
  const later = new Date(Date.now() + 60_000);
  const retaken = await Promise.all([
    store.claimPost(COMPANY, kind, "2026-10", later),
    store.claimPost(COMPANY, kind, "2026-10", later),
  ]);
  expect(retaken.sort()).toEqual([false, true]);

  await store.settlePost(COMPANY, kind, "2026-10", "posted", null);
  expect(await store.claimPost(COMPANY, kind, "2026-10", later)).toBe(false);
  expect(await store.findPosts({ kind, keys: ["2026-10"], companyId: COMPANY })).toMatchObject([
    { status: "posted" },
  ]);

  // Pruning takes old rows of one kind only.
  await store.claimPost(COMPANY, "bottest_kind", "old", longAgo);
  expect(await store.prunePosts("bottest_kind", new Date(Date.now() - 60_000))).toBe(0);
  expect(await store.prunePosts("bottest_kind", new Date(Date.now() + 60_000))).toBe(1);
  expect(await store.findPosts({ kind, keys: ["2026-10"], companyId: COMPANY })).toHaveLength(1);
});

test("what the bot found is saved for the settings screen, and settings are left alone", async () => {
  const now = new Date("2026-11-13T12:00:00Z");
  await store.saveGuildCheck(COMPANY, { guildId: GUILD, ok: false, reason: "Not theirs." }, now);
  await store.recordProblem(COMPANY, "The bot lacks Manage Roles.", now);
  await store.saveGuildCheck(COMPANY, { guildId: GUILD, ok: true, reason: null }, now);

  expect(await db.botStatus.findUnique({ where: { companyId: COMPANY } })).toEqual({
    companyId: COMPANY,
    guildId: GUILD,
    guildOk: true,
    guildReason: null,
    checkedAt: now,
    lastProblem: "The bot lacks Manage Roles.",
    lastProblemAt: now,
  });
  // A problem for a company that was never checked makes its own row.
  await store.recordProblem(OTHER, "x", now);
  expect((await db.botStatus.findUnique({ where: { companyId: OTHER } }))?.guildOk).toBe(false);

  const company = await db.company.findUnique({ where: { id: COMPANY } });
  expect(company?.settings).toEqual({
    discord: { deliveryChannelId: "200000000000000001" },
    about: "kept",
  });
});

test("end to end on the real tables: rows written by the API come out as posts and role changes", async () => {
  // The settings screen's own function sets the channels...
  await updateCompanySettings(db, COMPANY, (current) => ({
    ...current,
    discord: {
      ...current.discord,
      deliveryChannelId: "200000000000000001",
      rankUpChannelId: "200000000000000002",
    },
  }));
  // ...and the API's own function writes the rows.
  const deliveryRow = await enqueueOutbox(db, COMPANY, {
    type: "job_delivered",
    jobId: "bottest-job",
    driverId: "bottest-driver-driver",
    driverName: "driver",
    game: "ats",
    multiplayer: false,
    sourceCity: "Los Angeles",
    destCity: "Phoenix",
    cargo: "Lumber",
    drivenKm: 598,
    income: 9120,
  });
  const rankUpRow = await enqueueOutbox(db, COMPANY, {
    type: "rank_up",
    driverId: "bottest-driver-driver",
    driverName: "driver",
    rankName: "Veteran",
    kmInCompany: 1600,
    discordRoleId: "400000000000000002",
    previousDiscordRoleId: "400000000000000001",
  });

  const discord = new FakeDiscord();
  const role = { managed: false, elevated: false, aboveBot: false };
  discord.addGuild(GUILD, {
    channels: new Set(["200000000000000001", "200000000000000002"]),
    members: new Map([
      ["300000000000000001", { manageServer: true, roles: new Set<string>() }],
      ["300000000000000003", { manageServer: false, roles: new Set(["400000000000000001"]) }],
    ]),
    roles: new Map([
      ["400000000000000001", { name: "Rookie", ...role }],
      ["400000000000000002", { name: "Veteran", ...role }],
    ]),
  });
  // This database is shared: the bot under test only sees this test's rows.
  const onlyMine = {
    ...store,
    pendingOutbox: async (now: Date) =>
      (await store.pendingOutbox(now, 10_000)).filter((r) => r.companyId === COMPANY),
  };
  const bot = createBot({ store: onlyMine, discord, log: silentLogger });

  expect(await bot.outbox()).toBe(2);
  expect(await bot.outbox()).toBe(0);

  expect(discord.sent.map((s) => [s.channelId, s.message.embed.description])).toEqual([
    ["200000000000000001", "**driver** delivered Lumber from Los Angeles to Phoenix."],
    ["200000000000000002", "**driver** reached the rank **Veteran**."],
  ]);
  expect(discord.sent[0]!.message.embed.fields![0]!.value).toBe("598 km (372 mi)");
  expect(discord.sent[1]!.message.mentionUserIds).toEqual(["300000000000000003"]);
  expect(discord.roleChanges.map((c) => [c.action, c.roleId])).toEqual([
    ["add", "400000000000000002"],
    ["remove", "400000000000000001"],
  ]);
  for (const row of [deliveryRow, rankUpRow]) {
    expect(await db.outboxEvent.findUnique({ where: { id: row.id } })).toMatchObject({
      attempts: 1,
      lastError: null,
      nextAttemptAt: null,
      processedAt: expect.any(Date),
    });
  }
  expect(await db.botStatus.findUnique({ where: { companyId: COMPANY } })).toMatchObject({
    guildOk: true,
    guildReason: null,
  });
});
