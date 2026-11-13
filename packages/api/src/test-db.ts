// A real Postgres for tests that need one (transactions, row locks, unique
// keys). It is a separate database next to the development one, named
// "<dev database>_test", created and brought up to the Prisma schema on first
// use. The development database is never touched.
//
// Where it comes from, first match wins:
//   TEST_DATABASE_URL   used as given; its database name must end in "_test"
//   DATABASE_URL        from the environment, or from apps/web/.env
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import type { Session } from "@te-rebrand/auth";
import { createPrismaClient, type Database } from "@te-rebrand/db";

import type { Context } from "./context";
import type { CompanyRole } from "./index";

const REPO = path.resolve(import.meta.dir, "../../..");
const DB_PACKAGE = path.join(REPO, "packages/db");

function devDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envFile = path.join(REPO, "apps/web/.env");
  const line = existsSync(envFile)
    ? readFileSync(envFile, "utf8")
        .split(/\r?\n/)
        .find((l) => l.startsWith("DATABASE_URL="))
    : undefined;
  const value = line
    ?.slice("DATABASE_URL=".length)
    .trim()
    .replace(/^["']|["']$/g, "");
  if (!value) throw new Error("Tests need a database: set TEST_DATABASE_URL or DATABASE_URL.");
  return value;
}

function testDatabaseUrl() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? devDatabaseUrl());
  const name = decodeURIComponent(url.pathname.slice(1));
  if (!process.env.TEST_DATABASE_URL) url.pathname = `/${encodeURIComponent(`${name}_test`)}`;
  const testName = decodeURIComponent(url.pathname.slice(1));
  // Tests empty the tables they use. Never let them near a real database.
  if (!testName.endsWith("_test")) {
    throw new Error(`Refusing to run tests against "${testName}": the name must end in "_test".`);
  }
  return { url, name: testName };
}

/** Changes whenever the Prisma schema does, so the test database is pushed again. */
function schemaHash() {
  const dir = path.join(DB_PACKAGE, "prisma/schema");
  const hash = createHash("sha256");
  for (const file of readdirSync(dir).sort()) hash.update(readFileSync(path.join(dir, file)));
  return hash.digest("hex");
}

async function prepare(): Promise<Database> {
  const { url, name } = testDatabaseUrl();

  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const admin = createPrismaClient({ DATABASE_URL: adminUrl.toString() });
  const found = await admin.$queryRaw<unknown[]>`SELECT 1 FROM pg_database WHERE datname = ${name}`;
  if (found.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  await admin.$disconnect();

  const db = createPrismaClient({ DATABASE_URL: url.toString() });
  const wanted = schemaHash();
  const [stamp] = await db.$queryRaw<{ hash: string | null }[]>`
    SELECT shobj_description(oid, 'pg_database') AS hash
    FROM pg_database WHERE datname = current_database()`;
  if (stamp?.hash !== wanted) {
    // No --accept-data-loss: a schema change that would lose data stops here.
    const push = Bun.spawnSync(["bun", "x", "prisma", "db", "push"], {
      cwd: DB_PACKAGE,
      env: { ...process.env, DATABASE_URL: url.toString() },
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = push.stdout.toString() + push.stderr.toString();
    // Prisma names the database it pushed to; make sure it was ours.
    if (push.exitCode !== 0 || !out.includes(`"${name}"`)) {
      throw new Error(
        `Could not bring the test database "${name}" up to the schema. ` +
          "If the schema changed in a way that loses data, drop that database and run again.",
      );
    }
    await db.$executeRawUnsafe(`COMMENT ON DATABASE "${name}" IS '${wanted}'`);
  }
  // Start every run empty. Everything hangs off users and companies.
  await db.$executeRawUnsafe(`TRUNCATE "user", company, tracker_pairing CASCADE`);
  return db;
}

let ready: Promise<Database> | undefined;

/** The test database, prepared once per test run. */
export function testDb() {
  return (ready ??= prepare());
}

// ---- Fixtures ---------------------------------------------------------------

const id = (prefix: string) => `${prefix}-${randomUUID().slice(0, 8)}`;

export async function makeCompany(
  db: Database,
  ranks: { name: string; minKm: number; discordRoleId?: string }[] = [],
) {
  const companyId = id("company");
  return db.company.create({
    data: {
      id: companyId,
      name: `Company ${companyId}`,
      slug: companyId,
      ranks: { create: ranks },
    },
    include: { ranks: { orderBy: { minKm: "asc" } } },
  });
}

/** A user with a driver profile and one tracker; in `companyId` with `role`, or solo. */
export async function makeDriver(
  db: Database,
  membership?: { companyId: string; role?: CompanyRole },
) {
  const userId = id("user");
  const user = await db.user.create({
    data: {
      id: userId,
      name: userId,
      email: `${userId}@example.test`,
      driver: {
        create: {
          displayName: userId,
          trackerDevices: { create: { name: "Test PC", tokenHash: id("token") } },
          ...(membership
            ? {
                memberships: {
                  create: { companyId: membership.companyId, role: membership.role ?? "driver" },
                },
              }
            : {}),
        },
      },
    },
    include: { driver: { include: { trackerDevices: true } } },
  });
  const driver = user.driver!;
  return {
    ...driver,
    /** What `ingestJob` takes. */
    device: { id: driver.trackerDevices[0]!.id, driverId: driver.id },
    /** The tRPC context of this driver's browser. */
    ctx: { db, session: { user: { id: user.id, name: user.name } } as Session } satisfies Context,
  };
}

/** A stored job, delivered unless said otherwise. Not announced to the outbox. */
export function makeJob(
  db: Database,
  job: {
    driverId: string;
    companyId: string | null;
    drivenKm: number;
    income?: number;
    game?: "ets2" | "ats";
    status?: "delivered" | "cancelled" | "flagged" | "rejected";
    reportedAs?: "delivered" | "cancelled";
    flagReasons?: string[];
    finishedAt?: Date;
  },
) {
  const finishedAt = job.finishedAt ?? new Date();
  return db.job.create({
    data: {
      clientJobId: id("job"),
      game: "ets2",
      sourceCity: "Hamburg",
      sourceCompany: "Krone Logistics",
      destCity: "Lyon",
      destCompany: "TREE-ET",
      cargo: "Electronics",
      cargoMassKg: 18_400,
      plannedKm: job.drivenKm,
      odometerStart: 0,
      odometerEnd: job.drivenKm,
      income: 1000,
      damagePct: 0,
      maxSpeedKmh: 90,
      startedAt: new Date(finishedAt.getTime() - 3_600_000),
      status: "delivered",
      ...job,
      finishedAt,
    },
  });
}

/** What the Discord bot would find for a company, oldest first. */
export async function outbox(db: Database, companyId: string) {
  const rows = await db.outboxEvent.findMany({
    where: { companyId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => r.payload as Record<string, unknown> & { type: string });
}
