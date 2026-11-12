// Test data for local development: one VTC (Nordic Haulage) with ranks, seven
// test drivers, two months of jobs, a monthly goal and upcoming convoys. Your
// own driver (picked by SteamID) joins the company and gets jobs too, so the
// dashboard has something to show. Convoys come from TruckersMP: pass --vtc
// with a real TruckersMP VTC ID to show that VTC's events.
//
//   bun run db:seed -- --steam <your SteamID64> [--vtc <TruckersMP VTC ID>] [--other-vtc <ID>]
//     --vtc:       your test company's TruckersMP VTC (its convoys show in the first column)
//     --other-vtc: adds a second test VTC on Tacho (its convoys show in "Convoys on Tacho")
//     --solo:      you're not in a VTC; your jobs are solo jobs
//   bun run db:seed -- --clear                    # remove all of it
//
// Every row this creates is marked (ids, clientJobId and tokenHash start with
// "seed-"), so --clear never touches real data. Never run this against production.
import "varlock/auto-load";

import { createPrismaClient } from "./index";

const db = createPrismaClient({ DATABASE_URL: process.env.DATABASE_URL! });
const COMPANY_ID = "seed-company-nh";
// A second test VTC, so the dashboard's "Convoys on Tacho" column has someone else in it.
const OTHER_COMPANY_ID = "seed-company-bf";
const DAY = 86_400_000;

// Deterministic randomness, so every seed run produces the same data.
let state = 20261112;
function rand() {
  state = (state * 1664525 + 1013904223) % 2 ** 32;
  return state / 2 ** 32;
}
const pick = <T>(xs: readonly T[]) => xs[Math.floor(rand() * xs.length)]!;

// Planned distances are in-game km (map-scaled), roughly what the games show.
const ROUTES = [
  { game: "ets2", from: "Hamburg", to: "Lyon", km: 1196 },
  { game: "ets2", from: "Oslo", to: "Malmö", km: 612 },
  { game: "ets2", from: "Calais", to: "Paris", km: 289 },
  { game: "ets2", from: "Berlin", to: "Praha", km: 351 },
  { game: "ets2", from: "Milano", to: "Wien", km: 864 },
  { game: "ets2", from: "Bergen", to: "Oslo", km: 474 },
  { game: "ets2", from: "Rotterdam", to: "Hamburg", km: 487 },
  { game: "ets2", from: "Stockholm", to: "Göteborg", km: 468 },
  { game: "ets2", from: "München", to: "Verona", km: 438 },
  { game: "ets2", from: "Lisboa", to: "Madrid", km: 627 },
  { game: "ats", from: "Barstow", to: "Kingman", km: 330 },
  { game: "ats", from: "Los Angeles", to: "Phoenix", km: 598 },
  { game: "ats", from: "Seattle", to: "Portland", km: 281 },
  { game: "ats", from: "Las Vegas", to: "Salt Lake City", km: 676 },
  { game: "ats", from: "Denver", to: "Albuquerque", km: 715 },
] as const;
const CARGO = [
  "Electronics",
  "Fresh fish",
  "Lumber",
  "Furniture",
  "Steel coils",
  "Tractors",
  "Containers",
  "Produce",
  "Medical supplies",
  "Cement",
];
const COMPANIES = ["Krone Logistics", "TREE-ET", "Posped", "Transinet", "Kaarfor", "Wallbert"];
const RANKS = [
  { name: "Rookie", minKm: 0, color: "#9a8f84" },
  { name: "Driver", minKm: 5_000, color: "#2f63c4" },
  { name: "Senior Driver", minKm: 15_000, color: "#f5a524" },
  { name: "Veteran", minKm: 50_000, color: "#137a6d" },
  { name: "Legend", minKm: 150_000, color: "#9a5200" },
];
const TEST_DRIVERS = [
  { key: "kasper", name: "Kasper", role: "owner", jobs: 46 },
  { key: "ingrid", name: "Ingrid", role: "manager", jobs: 34 },
  { key: "truckertom", name: "TruckerTom", role: "driver", jobs: 30 },
  { key: "sofie", name: "Sofie", role: "driver", jobs: 24 },
  { key: "mehmet", name: "Mehmet", role: "driver", jobs: 19 },
  { key: "lukas", name: "Lukas", role: "driver", jobs: 12 },
  { key: "aiko", name: "Aiko", role: "driver", jobs: 8 },
] as const;

function makeJob(
  driverId: string,
  n: number,
  opts: { daysBack: number; now: number; deviceId?: string; solo?: boolean },
) {
  const route = pick(ROUTES);
  const status = rand() < 0.08 ? "cancelled" : "delivered";
  const drivenKm = Math.round(
    route.km * (status === "cancelled" ? 0.2 + rand() * 0.5 : 1 + rand() * 0.04),
  );
  // Odometer km per real hour is about speedometer x map scale (see flagReasons).
  const hours = drivenKm / (80 * (route.game === "ets2" ? 19 : 20)) + rand() * 0.3;
  const finishedAt = new Date(opts.now - rand() * opts.daysBack * DAY);
  const odometerStart = 40_000 + Math.round(rand() * 200_000);
  const mass = 8_000 + Math.round(rand() * 18_000);
  return {
    driverId,
    // Solo jobs belong to no company (docs/PLAN.md: companyId null if solo).
    companyId: opts.solo ? null : COMPANY_ID,
    deviceId: opts.deviceId ?? null,
    clientJobId: `seed-${driverId}-${n}`,
    game: route.game,
    multiplayer: rand() < 0.7,
    sourceCity: route.from,
    sourceCompany: pick(COMPANIES),
    destCity: route.to,
    destCompany: pick(COMPANIES),
    cargo: pick(CARGO),
    cargoMassKg: mass,
    plannedKm: route.km,
    drivenKm,
    odometerStart,
    odometerEnd: odometerStart + drivenKm,
    income: Math.round(route.km * (38 + rand() * 12)),
    damagePct: Math.round(rand() * 40) / 10,
    maxSpeedKmh: 85 + Math.round(rand() * 15),
    startedAt: new Date(finishedAt.getTime() - hours * 3_600_000),
    finishedAt,
    status: status as "delivered" | "cancelled" | "flagged",
    flagReasons: [] as string[],
  };
}

async function clear() {
  // Test users cascade to their drivers, memberships, jobs and signups; the
  // company cascades to ranks, goals and the remaining memberships.
  const users = await db.user.deleteMany({ where: { id: { startsWith: "seed-" } } });
  await db.company.deleteMany({ where: { id: { in: [COMPANY_ID, OTHER_COMPANY_ID] } } });
  const jobs = await db.job.deleteMany({ where: { clientJobId: { startsWith: "seed-" } } });
  const devices = await db.trackerDevice.deleteMany({
    where: { tokenHash: { startsWith: "seed-" } },
  });
  console.log(
    `Removed ${users.count} test users, ${jobs.count} of your test jobs, ${devices.count} test trackers and Nordic Haulage.`,
  );
}

async function seed(
  steamId: string,
  vtcId: number | null,
  otherVtcId: number | null,
  solo: boolean,
) {
  const me = await db.driver.findUnique({ where: { steamId64: steamId } });
  if (!me) {
    console.error(
      `No driver has SteamID ${steamId}. Log in and link Steam on the dashboard first.`,
    );
    process.exit(1);
  }
  const other = await db.membership.findFirst({
    where: { driverId: me.id, status: "active", companyId: { not: COMPANY_ID } },
    include: { company: { select: { name: true } } },
  });
  if (other) {
    console.error(
      `You're already in ${other.company.name}. Leave it first; drivers have one company at a time.`,
    );
    process.exit(1);
  }

  await clear();
  const now = Date.now();
  const monthStart = new Date(
    Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), 1),
  );
  const monthEnd = new Date(
    Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1) - 1,
  );

  await db.company.create({
    data: {
      id: COMPANY_ID,
      name: "Nordic Haulage",
      slug: "nordic-haulage",
      tag: "NH",
      // Optional: a real TruckersMP VTC, so its convoys show up.
      truckersmpVtcId: vtcId,
      verifiedAt: new Date(now - 90 * DAY),
      ranks: { create: RANKS },
      goals: {
        create: {
          title: "100 000 km together",
          metric: "km",
          target: 100_000,
          startAt: monthStart,
          endAt: monthEnd,
        },
      },
    },
  });

  // Test drivers, each a user + driver + membership + jobs.
  const testDriverIds: string[] = [];
  for (const d of TEST_DRIVERS) {
    const user = await db.user.create({
      data: {
        id: `seed-user-${d.key}`,
        name: d.name,
        email: `${d.key}@seed.example`,
        driver: { create: { displayName: d.name } },
      },
      include: { driver: true },
    });
    const driverId = user.driver!.id;
    testDriverIds.push(driverId);
    await db.membership.create({
      data: {
        companyId: COMPANY_ID,
        driverId,
        role: d.role,
        joinedAt: new Date(now - (60 + rand() * 300) * DAY),
      },
    });
    await db.job.createMany({
      data: Array.from({ length: d.jobs }, (_, n) => makeJob(driverId, n, { daysBack: 50, now })),
    });
  }

  // You: a manager in the company (unless --solo), a linked tracker, and your own job history.
  if (!solo) {
    await db.membership.create({
      data: {
        companyId: COMPANY_ID,
        driverId: me.id,
        role: "manager",
        joinedAt: new Date(now - 120 * DAY),
      },
    });
  }
  const device = await db.trackerDevice.create({
    data: {
      driverId: me.id,
      name: "Gaming PC (test)",
      // Not a real token hash: this device can't authenticate.
      tokenHash: `seed-${crypto.randomUUID()}`,
      appVersion: "0.1.0",
      lastSeenAt: new Date(now - 2 * 3_600_000),
    },
  });
  const myJobs = Array.from({ length: 28 }, (_, n) =>
    makeJob(me.id, n, { daysBack: 55, now, deviceId: device.id, solo }),
  );
  // One flagged job, so the "flagged" state is visible too.
  myJobs[3] = { ...myJobs[3]!, status: "flagged", flagReasons: ["avg_speed"] };
  await db.job.createMany({ data: myJobs });

  if (otherVtcId !== null) {
    await db.company.create({
      data: {
        id: OTHER_COMPANY_ID,
        name: "Baltic Freight",
        slug: "baltic-freight",
        tag: "BF",
        truckersmpVtcId: otherVtcId,
        verifiedAt: new Date(now - 30 * DAY),
      },
    });
  }

  const total = await db.job.count({ where: { companyId: COMPANY_ID } });
  console.log(
    `Seeded Nordic Haulage: ${TEST_DRIVERS.length} test drivers, ${total} jobs, 5 ranks, 1 goal.`,
  );
  console.log(
    vtcId
      ? `Nordic Haulage's convoys come from TruckersMP VTC ${vtcId}.`
      : "No --vtc given: Nordic Haulage shows no convoys.",
  );
  console.log(
    solo
      ? `${me.displayName} is not in a VTC: ${myJobs.length} solo jobs and a test tracker.`
      : `${me.displayName} is a manager there with ${myJobs.length} jobs and a test tracker.`,
  );
}

const args = process.argv.slice(2);
if (args.includes("--clear")) {
  await clear();
} else {
  const steam = args[args.indexOf("--steam") + 1];
  if (!args.includes("--steam") || !steam || !/^\d{17}$/.test(steam)) {
    console.error(
      "Usage: bun run db:seed -- --steam <SteamID64> [--vtc <ID>] [--other-vtc <ID>] [--solo]   (or --clear)",
    );
    process.exit(1);
  }
  const vtcArg = args.includes("--vtc") ? Number(args[args.indexOf("--vtc") + 1]) : null;
  if (vtcArg !== null && !Number.isInteger(vtcArg)) {
    console.error(
      "--vtc takes the number from the VTC's TruckersMP URL, e.g. truckersmp.com/vtc/12345",
    );
    process.exit(1);
  }
  const otherArg = args.includes("--other-vtc")
    ? Number(args[args.indexOf("--other-vtc") + 1])
    : null;
  if (otherArg !== null && !Number.isInteger(otherArg)) {
    console.error("--other-vtc takes a TruckersMP VTC ID, e.g. 12345");
    process.exit(1);
  }
  await seed(steam, vtcArg, otherArg, args.includes("--solo"));
}
await db.$disconnect();
