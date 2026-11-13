import { expect, test } from "bun:test";

import fixture from "../../../crates/telemetry/tests/fixtures/job-upload.json";
import { JobUploadSchema, MAX_JOB_EVENTS } from "./index";

test("the shared Rust/TS fixture parses", () => {
  const parsed = JobUploadSchema.parse(fixture);
  expect(parsed.job.job.destination_city).toBe("Lyon");
});

test("rejects unknown games", () => {
  const bad = structuredClone(fixture) as { job: { game: string } };
  bad.job.game = "fs22";
  expect(JobUploadSchema.safeParse(bad).success).toBe(false);
});

test("the fixture's events come through exactly as the tracker wrote them", () => {
  // Nothing dropped or renamed on the way: what Rust serialises is what the API reads.
  const events: unknown = JobUploadSchema.parse(fixture).job.events;
  expect(events).toEqual(fixture.job.events);
  expect(fixture.job.events.map((e) => e.type)).toEqual(["toll", "fine", "ferry", "train"]);
});

test("a job from a tracker without job events is accepted, with none", () => {
  const old = structuredClone(fixture) as { job: { events?: unknown } };
  delete old.job.events;
  const parsed = JobUploadSchema.parse(old);
  expect(parsed.job.events).toEqual([]);
});

test("rejects events it does not know, or that miss their details", () => {
  const withEvent = (event: unknown) => {
    const upload = structuredClone(fixture) as { job: { events: unknown[] } };
    upload.job.events = [event];
    return JobUploadSchema.safeParse(upload).success;
  };
  expect(withEvent({ at_ms: 2000, type: "toll", amount: 38 })).toBe(true);
  expect(withEvent({ at_ms: 2000, type: "speeding", amount: 38 })).toBe(false);
  expect(withEvent({ at_ms: 2000, type: "fine", amount: 550 })).toBe(false);
  expect(withEvent({ at_ms: 2000, type: "ferry", source: "Dover", amount: 320 })).toBe(false);
  expect(withEvent({ type: "toll", amount: 38 })).toBe(false);
  expect(withEvent({ at_ms: 2000, type: "toll", amount: 38.5 })).toBe(false);
});

test("caps how many events one job can carry", () => {
  const upload = structuredClone(fixture) as { job: { events: unknown[] } };
  const toll = { at_ms: 2000, type: "toll", amount: 1 };
  upload.job.events = Array.from({ length: MAX_JOB_EVENTS }, () => toll);
  expect(JobUploadSchema.safeParse(upload).success).toBe(true);
  upload.job.events.push(toll);
  expect(JobUploadSchema.safeParse(upload).success).toBe(false);
});
