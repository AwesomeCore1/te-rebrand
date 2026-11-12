import { expect, test } from "bun:test";

import fixture from "../../../crates/telemetry/tests/fixtures/job-upload.json";
import { JobUploadSchema } from "./index";

test("the shared Rust/TS fixture parses", () => {
  const parsed = JobUploadSchema.parse(fixture);
  expect(parsed.job.job.destination_city).toBe("Lyon");
});

test("rejects unknown games", () => {
  const bad = structuredClone(fixture) as { job: { game: string } };
  bad.job.game = "fs22";
  expect(JobUploadSchema.safeParse(bad).success).toBe(false);
});
