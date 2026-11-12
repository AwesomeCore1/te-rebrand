// Server side of the tracker app: device tokens, pairing, job ingestion and
// live positions. Used by the REST routes under apps/web/src/routes/api/tracker.
// The tracker never decides what counts: everything is checked here.
import type { Database } from "@te-rebrand/db";
import type { JobUpload, PositionUpdate } from "@te-rebrand/telemetry-types";

const TOKEN_PREFIX = "te_dev_";
const PAIRING_TTL_S = 10 * 60;
export const PAIRING_POLL_INTERVAL_S = 5;

function randomToken(bytes = 32) {
  const buf = crypto.getRandomValues(new Uint8Array(bytes));
  return Buffer.from(buf).toString("base64url");
}

export async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Buffer.from(digest).toString("hex");
}

// No 0/O/1/I, so codes survive being read aloud or retyped.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function userCode() {
  const buf = crypto.getRandomValues(new Uint8Array(8));
  const chars = Array.from(buf, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

export function normaliseUserCode(code: string) {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : null;
}

// ---- Pairing (device-code flow) -----------------------------------------

export async function startPairing(db: Database, deviceName: string, appVersion?: string) {
  const deviceCode = randomToken();
  const pairing = await db.trackerPairing.create({
    data: {
      deviceCodeHash: await sha256(deviceCode),
      userCode: userCode(),
      deviceName,
      appVersion,
      expiresAt: new Date(Date.now() + PAIRING_TTL_S * 1000),
    },
  });
  return { deviceCode, userCode: pairing.userCode, expiresIn: PAIRING_TTL_S };
}

/** Called from the website by the logged-in driver who typed/opened the code. */
export async function approvePairing(db: Database, driverId: string, code: string) {
  const normalised = normaliseUserCode(code);
  if (!normalised) return null;
  const { count } = await db.trackerPairing.updateMany({
    where: { userCode: normalised, approvedAt: null, expiresAt: { gt: new Date() } },
    data: { driverId, approvedAt: new Date() },
  });
  if (count === 0) return null;
  return db.trackerPairing.findUnique({ where: { userCode: normalised } });
}

type PollResult =
  | { status: "pending" }
  | { status: "expired" }
  | { status: "approved"; token: string; driverName: string };

/** Called by the app. Hands out the device token exactly once. */
export async function pollPairing(db: Database, deviceCode: string): Promise<PollResult> {
  const pairing = await db.trackerPairing.findUnique({
    where: { deviceCodeHash: await sha256(deviceCode) },
    include: { driver: true },
  });
  if (!pairing || pairing.expiresAt < new Date()) return { status: "expired" };
  if (!pairing.approvedAt || !pairing.driver) return { status: "pending" };

  const token = TOKEN_PREFIX + randomToken();
  await db.$transaction([
    // Deleting first means a second poll with the same code finds nothing.
    db.trackerPairing.delete({ where: { id: pairing.id } }),
    db.trackerDevice.create({
      data: {
        driverId: pairing.driver.id,
        name: pairing.deviceName,
        appVersion: pairing.appVersion,
        tokenHash: await sha256(token),
        lastSeenAt: new Date(),
      },
    }),
  ]);
  return { status: "approved", token, driverName: pairing.driver.displayName };
}

// ---- Device auth ------------------------------------------------------------

export async function authenticateDevice(db: Database, authorization: string | null) {
  const token = authorization?.match(/^Bearer (\S+)$/)?.[1];
  if (!token?.startsWith(TOKEN_PREFIX)) return null;
  const device = await db.trackerDevice.findUnique({
    where: { tokenHash: await sha256(token) },
    include: { driver: true },
  });
  if (!device || device.revokedAt) return null;
  return device;
}

// ---- Job ingestion ----------------------------------------------------------

export const LIMITS = {
  /** Trucks in either game can't sustain more than this, even unlimited in singleplayer. */
  maxSpeedKmh: 200,
  /**
   * Road distances are map-scaled (ETS2 1:19, ATS 1:20), so odometer km per
   * real hour is roughly speedometer km/h times the scale. Allow 10% on top.
   */
  mapScale: { ets2: 19, ats: 20 } as const,
  avgSpeedSlack: 1.1,
  /** Leeway between odometer delta and reported driven distance. */
  odometerToleranceKm: 1,
  /** Clock skew we accept between the driver's PC and the server. */
  futureToleranceMs: 5 * 60_000,
};

/** Pure plausibility checks. Any reason means the job is stored as `flagged` for review. */
export function flagReasons(upload: JobUpload, now = new Date()): string[] {
  const reasons: string[] = [];
  const { job } = upload;
  const started = new Date(upload.started_at).getTime();
  const finished = new Date(upload.finished_at).getTime();
  const hours = (finished - started) / 3_600_000;

  if (!(hours > 0)) reasons.push("finish_before_start");
  else {
    const ceiling =
      Math.max(job.max_speed_kmh, 1) * LIMITS.mapScale[job.game] * LIMITS.avgSpeedSlack;
    if (job.driven_km / hours > ceiling) reasons.push("avg_speed");
  }
  if (finished > now.getTime() + LIMITS.futureToleranceMs) reasons.push("finished_in_future");
  if (job.max_speed_kmh > LIMITS.maxSpeedKmh) reasons.push("max_speed");
  if (
    Math.abs(job.odometer_end_km - job.odometer_start_km - job.driven_km) >
    LIMITS.odometerToleranceKm
  ) {
    reasons.push("odometer_mismatch");
  }
  const planned = job.job.planned_distance_km;
  if (planned > 0 && job.driven_km > Math.max(planned * 2.5, planned + 300)) {
    reasons.push("far_longer_than_planned");
  }
  return reasons;
}

export async function ingestJob(
  db: Database,
  device: { id: string; driverId: string },
  upload: JobUpload,
) {
  const reasons = flagReasons(upload);
  // Counts for the company the driver is in right now (docs/PLAN.md: Job).
  const membership = await db.membership.findFirst({
    where: { driverId: device.driverId, status: "active" },
    select: { companyId: true },
  });
  const { job } = upload;
  const data = {
    driverId: device.driverId,
    deviceId: device.id,
    companyId: membership?.companyId ?? null,
    clientJobId: upload.client_job_id,
    game: job.game,
    multiplayer: upload.multiplayer,
    sourceCity: job.job.source_city,
    sourceCompany: job.job.source_company,
    destCity: job.job.destination_city,
    destCompany: job.job.destination_company,
    cargo: job.job.cargo,
    cargoMassKg: job.job.cargo_mass_kg,
    plannedKm: job.job.planned_distance_km,
    drivenKm: job.driven_km,
    odometerStart: job.odometer_start_km,
    odometerEnd: job.odometer_end_km,
    income: job.job.income,
    damagePct: job.cargo_damage * 100,
    maxSpeedKmh: job.max_speed_kmh,
    startedAt: new Date(upload.started_at),
    finishedAt: new Date(upload.finished_at),
    status: reasons.length > 0 ? ("flagged" as const) : job.status,
    flagReasons: reasons,
  };
  // Idempotent: the app retries until it gets a 2xx, so a repeat is a no-op.
  const saved = await db.job.upsert({
    where: {
      driverId_clientJobId: { driverId: device.driverId, clientJobId: upload.client_job_id },
    },
    create: data,
    update: {},
  });
  await db.trackerDevice.update({ where: { id: device.id }, data: { lastSeenAt: new Date() } });
  return saved;
}

// ---- Live map ---------------------------------------------------------------
// Only the latest position per driver, in memory (docs/PLAN.md). One server
// process for now; move to Redis if the web app is ever scaled out.

export type LivePosition = PositionUpdate & {
  driverId: string;
  displayName: string;
  companyId: string | null;
  showOnLiveMap: boolean;
  receivedAt: number;
};

const POSITION_TTL_MS = 30_000;
const positions = new Map<string, LivePosition>();

export function recordPosition(position: LivePosition) {
  positions.set(position.driverId, position);
}

export function livePositions(filter: { companyId?: string } = {}, now = Date.now()) {
  const out: LivePosition[] = [];
  for (const [driverId, p] of positions) {
    if (now - p.receivedAt > POSITION_TTL_MS) {
      positions.delete(driverId);
      continue;
    }
    if (filter.companyId ? p.companyId === filter.companyId : p.showOnLiveMap) out.push(p);
  }
  return out;
}
