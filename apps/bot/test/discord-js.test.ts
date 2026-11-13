// The parts of the real adapter that need no connection: how Discord's errors
// are read, and that an embed never exceeds Discord's limits.
import { expect, test } from "bun:test";

import { DiscordAPIError, HTTPError } from "discord.js";

import { DiscordError } from "../src/discord";
import { toApiEmbed, toDiscordError } from "../src/discord-js";
import { dedupeKey } from "../src/ledger";

const apiError = (code: number, status: number, message = "nope") =>
  new DiscordAPIError({ code, message }, code, status, "POST", "/channels/1/messages", {});

test("Discord's error codes become reasons the bot can act on", () => {
  const kind = (error: unknown) => toDiscordError(error, "posting").kind;
  expect(kind(apiError(50013, 403))).toBe("missing_permission"); // Missing Permissions
  expect(kind(apiError(50001, 403))).toBe("missing_permission"); // Missing Access
  expect(kind(apiError(10003, 404))).toBe("not_found"); // Unknown Channel
  expect(kind(apiError(10007, 404))).toBe("not_found"); // Unknown Member
  expect(kind(apiError(10011, 404))).toBe("not_found"); // Unknown Role
  expect(kind(apiError(50035, 400))).toBe("rejected"); // Invalid Form Body
  expect(kind(apiError(0, 502))).toBe("temporary");
  expect(kind(new HTTPError(503, "Service Unavailable", "POST", "/x", {}))).toBe("temporary");
  expect(kind(new Error("The operation was aborted due to timeout"))).toBe("no_answer");
  expect(kind(new TypeError("fetch failed"))).toBe("no_answer");
});

test("only passing errors are worth another try", () => {
  expect(toDiscordError(apiError(0, 500), "x").passes).toBe(true);
  expect(toDiscordError(new Error("timeout"), "x").passes).toBe(true);
  expect(toDiscordError(apiError(50013, 403), "x").passes).toBe(false);
  expect(toDiscordError(apiError(10003, 404), "x").passes).toBe(false);
});

test("an error the adapter already explained is passed on as it is", () => {
  const own = new DiscordError("missing_permission", "The bot lacks EmbedLinks in #feed.");
  expect(toDiscordError(own, "posting")).toBe(own);
});

test("embeds are cut to Discord's limits", () => {
  const embed = toApiEmbed({
    title: "t".repeat(400),
    description: "d".repeat(5000),
    fields: [{ name: "n".repeat(300), value: "v".repeat(2000) }],
    footer: "Delivered jobs only.",
    color: 0xf5a524,
  });
  expect(embed.title).toHaveLength(256);
  expect(embed.description).toHaveLength(4096);
  expect(embed.fields![0]!.name).toHaveLength(256);
  expect(embed.fields![0]!.value).toHaveLength(1024);
  expect(embed.footer).toEqual({ text: "Delivered jobs only." });
});

test("the duplicate-check key fits Discord's 25 characters and is stable", () => {
  const key = dedupeKey("outbox", "cmhx0000000000000000000000");
  expect(key).toHaveLength(25);
  expect(dedupeKey("outbox", "cmhx0000000000000000000000")).toBe(key);
  expect(dedupeKey("outbox", "another")).not.toBe(key);
});
