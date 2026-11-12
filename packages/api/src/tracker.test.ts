import { expect, test } from "bun:test";

import fixture from "../../../crates/telemetry/tests/fixtures/job-upload.json";
import { JobUploadSchema } from "@te-rebrand/telemetry-types";

import { flagReasons, livePositions, normaliseUserCode, recordPosition } from "./tracker";

const NOW = new Date("2026-11-12T20:00:00Z");
const upload = () => JobUploadSchema.parse(structuredClone(fixture));

test("a normal delivery is not flagged", () => {
  expect(flagReasons(upload(), NOW)).toEqual([]);
});

test("flags impossible average speed (teleport)", () => {
  const u = upload();
  u.finished_at = "2026-11-12T18:10:00Z"; // 1196 km in 10 minutes
  expect(flagReasons(u, NOW)).toContain("avg_speed");
});

test("flags top speed, odometer mismatch, and finish before start", () => {
  const u = upload();
  u.job.max_speed_kmh = 260;
  u.job.odometer_end_km += 500;
  u.finished_at = "2026-11-12T17:00:00Z";
  expect(flagReasons(u, NOW)).toEqual(
    expect.arrayContaining(["max_speed", "odometer_mismatch", "finish_before_start"]),
  );
});

test("flags jobs finishing in the future", () => {
  expect(flagReasons(upload(), new Date("2026-11-12T18:30:00Z"))).toContain("finished_in_future");
});

test("normalises typed pairing codes", () => {
  expect(normaliseUserCode(" abcd efgh ")).toBe("ABCD-EFGH");
  expect(normaliseUserCode("abc")).toBeNull();
});

test("live map hides drivers who opted out, except from their own company", () => {
  const base = {
    game: "ets2" as const,
    multiplayer: true,
    server: null,
    x: 1,
    z: 2,
    speed_kmh: 80,
    at: NOW.toISOString(),
    displayName: "A",
    receivedAt: NOW.getTime(),
  };
  recordPosition({ ...base, driverId: "hidden", companyId: "c1", showOnLiveMap: false });
  recordPosition({ ...base, driverId: "shown", companyId: null, showOnLiveMap: true });
  const ids = (ps: { driverId: string }[]) => ps.map((p) => p.driverId).sort();
  expect(ids(livePositions({}, NOW.getTime()))).toEqual(["shown"]);
  expect(ids(livePositions({ companyId: "c1" }, NOW.getTime()))).toEqual(["hidden"]);
  expect(livePositions({}, NOW.getTime() + 60_000)).toEqual([]);
});
