// Fake traffic for the live map, for local development: puts the seeded test
// drivers (bun run db:seed) on the road without a game running. Each one gets a
// tracker device and sends a position to the real endpoint every 5 seconds,
// exactly as the tracker app does, so the whole path is exercised.
//
//   cd packages/db && bun src/dev-drive.ts [--url http://localhost:3001] [--drivers 7] [--interval 5]
//
// Stop it with Ctrl+C; it removes its devices again. Routes are made-up loops
// in game coordinates, not real roads. Never run this against production.
import "varlock/auto-load";

import { createHash, randomBytes } from "node:crypto";

import { createPrismaClient } from "./index";

const arg = (name: string, fallback: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? (process.argv[i + 1] ?? fallback) : fallback;
};
const BASE_URL = arg("url", "http://localhost:3001").replace(/\/$/, "");
const INTERVAL_S = Number(arg("interval", "5"));
const MAX_DRIVERS = Number(arg("drivers", "7"));
// One set of devices per target, so two runs against different servers don't clash.
const DEVICE_NAME = `dev-drive (fake traffic for ${BASE_URL})`;

const db = createPrismaClient({ DATABASE_URL: process.env.DATABASE_URL! });

type Plan = {
  game: "ets2" | "ats";
  multiplayer: boolean;
  server: string | null;
  /** Centre of the loop and its radius, game metres. */
  cx: number;
  cz: number;
  radius: number;
  cruiseKmh: number;
  /** Where on the loop they start, 0 to 1. */
  offset: number;
};

// A convoy of four near each other in ETS2, one singleplayer driver on their
// own, and two in ATS.
const PLANS: Plan[] = [
  convoy(0),
  convoy(1),
  convoy(2),
  convoy(3),
  {
    game: "ets2",
    multiplayer: false,
    server: null,
    cx: -31_000,
    cz: 24_000,
    radius: 5_200,
    cruiseKmh: 84,
    offset: 0.3,
  },
  {
    game: "ats",
    multiplayer: true,
    server: "ATS Simulation",
    cx: -88_000,
    cz: 9_000,
    radius: 6_400,
    cruiseKmh: 96,
    offset: 0.1,
  },
  {
    game: "ats",
    multiplayer: true,
    server: "ATS Simulation",
    cx: -41_000,
    cz: -22_000,
    radius: 4_800,
    cruiseKmh: 88,
    offset: 0.6,
  },
];

function convoy(place: number): Plan {
  return {
    game: "ets2",
    multiplayer: true,
    server: "Simulation 1",
    cx: 14_000,
    cz: -18_000,
    radius: 3_600,
    cruiseKmh: 78,
    // About 120 m between trucks.
    offset: 0.5 - place * 0.0053,
  };
}

/** Position on a wobbly loop, so paths aren't perfect circles. */
function at(plan: Plan, travelledM: number) {
  const length = 2 * Math.PI * plan.radius;
  const t = (plan.offset + travelledM / length) * 2 * Math.PI;
  const r = plan.radius * (1 + 0.18 * Math.sin(3 * t) + 0.07 * Math.cos(5 * t));
  return { x: plan.cx + r * Math.cos(t), z: plan.cz + r * Math.sin(t) };
}

async function main() {
  const drivers = await db.driver.findMany({
    where: { userId: { startsWith: "seed-user-" } },
    orderBy: { displayName: "asc" },
    take: Math.min(MAX_DRIVERS, PLANS.length),
  });
  if (drivers.length === 0) {
    console.error("No seeded test drivers. Run `bun run db:seed -- --steam <SteamID64>` first.");
    process.exit(1);
  }

  // Left over from a run that was killed.
  await db.trackerDevice.deleteMany({ where: { name: DEVICE_NAME } });
  const trucks = await Promise.all(
    drivers.map(async (driver, i) => {
      const token = `te_dev_${randomBytes(32).toString("base64url")}`;
      await db.trackerDevice.create({
        data: {
          driverId: driver.id,
          name: DEVICE_NAME,
          tokenHash: createHash("sha256").update(token).digest("hex"),
        },
      });
      return { name: driver.displayName, token, plan: PLANS[i]!, travelledM: 0 };
    }),
  );

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    await db.trackerDevice.deleteMany({ where: { name: DEVICE_NAME } });
    await db.$disconnect();
    console.log("\nStopped. They drop off the map within 30 seconds.");
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  console.log(
    `${trucks.length} test drivers driving against ${BASE_URL}: ${trucks.map((t) => t.name).join(", ")}`,
  );
  console.log(`Open ${BASE_URL}/map. Ctrl+C to stop.`);

  const started = Date.now();
  let tick = 0;
  while (!stopping) {
    const elapsedS = (Date.now() - started) / 1000;
    await Promise.all(
      trucks.map(async (truck, i) => {
        // Speed drifts around the cruise speed; the last ETS2 convoy truck
        // pulls over for a while every few minutes.
        const resting = i === 3 && Math.floor(elapsedS / 60) % 4 === 3;
        const kmh = resting ? 0 : truck.plan.cruiseKmh + 9 * Math.sin(elapsedS / 17 + i * 1.3);
        if (tick > 0) truck.travelledM += (kmh / 3.6) * INTERVAL_S;
        const { x, z } = at(truck.plan, truck.travelledM);
        try {
          const res = await fetch(`${BASE_URL}/api/tracker/position`, {
            method: "POST",
            headers: { authorization: `Bearer ${truck.token}`, "content-type": "application/json" },
            body: JSON.stringify({
              game: truck.plan.game,
              multiplayer: truck.plan.multiplayer,
              server: truck.plan.server,
              x,
              z,
              speed_kmh: Math.max(0, kmh),
              at: new Date().toISOString(),
            }),
          });
          if (!res.ok) console.error(`${truck.name}: HTTP ${res.status}`);
        } catch (e) {
          console.error(`${truck.name}: ${e instanceof Error ? e.message : e}`);
        }
      }),
    );
    tick++;
    await new Promise((r) => setTimeout(r, INTERVAL_S * 1000));
  }
}

await main();
