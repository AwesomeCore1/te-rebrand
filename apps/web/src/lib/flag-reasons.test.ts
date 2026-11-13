import { expect, test } from "bun:test";

import { botInviteUrl, BOT_PERMISSIONS, isDiscordId } from "./discord";
import { describeFlag, formatDuration } from "./flag-reasons";

const job = {
  drivenKm: 1196,
  plannedKm: 400,
  odometerStart: 50_210,
  odometerEnd: 51_906,
  maxSpeedKmh: 260,
  startedAt: "2026-11-12T18:00:00Z",
  finishedAt: "2026-11-12T18:10:00Z",
};

test("durations read like a clock, not a decimal", () => {
  expect(formatDuration(10 * 60_000)).toBe("10 min");
  expect(formatDuration(65 * 60_000)).toBe("1 h 5 min");
  expect(formatDuration(120 * 60_000)).toBe("2 h");
  expect(formatDuration(-5)).toBe("0 min");
});

test("every reason the API gives has a sentence with the job's numbers", () => {
  expect(describeFlag("avg_speed", job)).toBe(
    "Too far for the time: 1 196 km in 10 min, with a top speed of 260 km/h.",
  );
  expect(describeFlag("max_speed", job)).toContain("260 km/h");
  expect(describeFlag("odometer_mismatch", job)).toBe(
    "The odometer moved 1 696 km, but the job reports 1 196 km driven.",
  );
  expect(describeFlag("far_longer_than_planned", job)).toBe(
    "Drove 1 196 km on a route planned at 400 km.",
  );
  expect(describeFlag("finish_before_start", job)).toContain("ends before it starts");
  expect(describeFlag("finished_in_future", job)).toContain("future");
});

test("a manager who reads miles gets miles; stored values stay km", () => {
  expect(describeFlag("max_speed", job, "mi")).toContain("162 mph");
  expect(describeFlag("far_longer_than_planned", job, "mi")).toBe(
    "Drove 743 mi on a route planned at 249 mi.",
  );
});

test("a reason this page does not know yet is shown by its code", () => {
  expect(describeFlag("new_check", job)).toContain("new_check");
});

test("the bot link asks for the bot scope and exactly the four permissions", () => {
  // View Channel, Send Messages, Embed Links, Manage Roles.
  expect(BOT_PERMISSIONS).toBe(1024 + 2048 + 16384 + 268435456);
  const url = new URL(botInviteUrl("1234567890"));
  expect(url.origin + url.pathname).toBe("https://discord.com/oauth2/authorize");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    client_id: "1234567890",
    scope: "bot",
    permissions: "268454912",
  });
});

test("the bot link preselects the server only for a real server id", () => {
  const withServer = new URL(botInviteUrl("1234567890", "123456789012345678"));
  expect(withServer.searchParams.get("guild_id")).toBe("123456789012345678");
  expect(new URL(botInviteUrl("1234567890", "my server")).searchParams.has("guild_id")).toBe(false);
  expect(new URL(botInviteUrl("1234567890", "")).searchParams.has("guild_id")).toBe(false);
  expect(isDiscordId("123456789012345678")).toBe(true);
  expect(isDiscordId("12ab")).toBe(false);
});
