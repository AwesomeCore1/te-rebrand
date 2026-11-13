import { expect, test } from "bun:test";

import type { Logger } from "../src/log";
import { every } from "../src/loops";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

test("a loop keeps going after an error, never overlaps itself, and stops when told", async () => {
  const errors: string[] = [];
  const log: Logger = { info() {}, warn() {}, error: (message) => errors.push(message) };
  let runs = 0;
  let running = 0;
  let overlapped = false;

  const loop = every(
    "test job",
    5,
    async () => {
      if (++running > 1) overlapped = true;
      runs++;
      await wait(10);
      running--;
      if (runs <= 3) throw new Error("database is down");
    },
    log,
  );
  await wait(120);
  await loop.stop();
  const atStop = runs;
  await wait(40);

  expect(atStop).toBeGreaterThan(4);
  expect(runs).toBe(atStop);
  expect(overlapped).toBe(false);
  // The same failure three times in a row is reported once.
  expect(errors).toEqual(["test job failed, will keep trying"]);
});
