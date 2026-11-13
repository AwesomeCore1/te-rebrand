import { expect, test } from "bun:test";

import { DiscordError } from "../src/discord";
import { CLAIM_MS, INTERRUPTED_NOTE, MAX_ATTEMPTS, RETRY_WAITS_MS } from "../src/outbox";
import { CHANNEL, delivery, DRIVER, GUILD, rankUp, ROLE, world } from "./fakes";

const down = () => new DiscordError("temporary", "Discord had a problem (503).");

test("a delivery is posted in the delivery channel and the row marked processed", async () => {
  const { bot, store, discord, clock } = world();
  const row = store.enqueue("nh", delivery(), clock.now());

  expect(await bot.outbox()).toBe(1);

  expect(discord.sent).toHaveLength(1);
  expect(discord.sent[0]!.channelId).toBe(CHANNEL.delivery);
  expect(discord.sent[0]!.message.embed.description).toBe(
    "**Ingrid** delivered Electronics from Hamburg to Lyon.",
  );
  expect(row).toMatchObject({ processedAt: clock.now(), attempts: 1, lastError: null });

  // Nothing left to do: the next rounds post nothing.
  expect(await bot.outbox()).toBe(0);
  expect(discord.sent).toHaveLength(1);
});

test("a rank-up is posted, the new role given and the previous one taken", async () => {
  const { bot, store, discord, clock } = world();
  const row = store.enqueue("nh", rankUp(), clock.now());

  await bot.outbox();

  expect(discord.sent).toHaveLength(1);
  expect(discord.sent[0]!.channelId).toBe(CHANNEL.rankUp);
  expect(discord.sent[0]!.message.content).toBe(`<@${DRIVER}>`);
  expect(discord.sent[0]!.message.mentionUserIds).toEqual([DRIVER]);
  expect(discord.roleChanges).toEqual([
    { action: "add", guildId: GUILD, userId: DRIVER, roleId: ROLE.veteran },
    { action: "remove", guildId: GUILD, userId: DRIVER, roleId: ROLE.rookie },
  ]);
  expect([...discord.guilds.get(GUILD)!.members.get(DRIVER)!.roles]).toEqual([ROLE.veteran]);
  expect(row.processedAt).not.toBeNull();
  expect(row.lastError).toBeNull();
});

test("rows are handled oldest first", async () => {
  const { bot, store, discord, clock } = world();
  store.enqueue("nh", delivery({ destCity: "Second" }), new Date("2026-11-13T11:59:00Z"));
  store.enqueue("nh", delivery({ destCity: "First" }), new Date("2026-11-13T11:58:00Z"));
  clock.set("2026-11-13T12:00:00Z");

  await bot.outbox();

  expect(discord.sent.map((s) => s.message.embed.description)).toEqual([
    expect.stringContaining("to First"),
    expect.stringContaining("to Second"),
  ]);
});

test("a company without a Discord server: processed and skipped", async () => {
  const { bot, store, discord, clock } = world();
  store.addCompany({ id: "solo", name: "No Discord Ltd" });
  const a = store.enqueue("solo", delivery(), clock.now());
  const b = store.enqueue("solo", rankUp(), clock.now());

  await bot.outbox();

  expect(discord.sent).toHaveLength(0);
  expect(discord.roleChanges).toHaveLength(0);
  for (const row of [a, b]) {
    expect(row.processedAt).not.toBeNull();
    expect(row.lastError).toBe("Skipped: the company has no Discord server set.");
  }
});

test("a company without that channel: processed and skipped", async () => {
  const { bot, store, discord, clock, company } = world();
  company.discord.deliveryChannelId = null;
  const row = store.enqueue("nh", delivery(), clock.now());

  await bot.outbox();

  expect(discord.sent).toHaveLength(0);
  expect(row.processedAt).not.toBeNull();
  expect(row.lastError).toBe("Skipped: no delivery channel is set.");
});

test("a rank-up without a rank-up channel still changes the roles, and posts nothing", async () => {
  const { bot, store, discord, clock, company } = world();
  company.discord.rankUpChannelId = null;
  const row = store.enqueue("nh", rankUp(), clock.now());

  await bot.outbox();

  expect(discord.sent).toHaveLength(0);
  expect(discord.roleChanges.map((c) => c.action)).toEqual(["add", "remove"]);
  expect(row.processedAt).not.toBeNull();
  expect(row.lastError).toBe("No rank-up channel is set, so nothing was posted.");
});

test("a rank-up with no channel and no roles is skipped", async () => {
  const { bot, store, discord, clock, company } = world();
  company.discord.rankUpChannelId = null;
  const row = store.enqueue(
    "nh",
    rankUp({ discordRoleId: null, previousDiscordRoleId: null }),
    clock.now(),
  );

  await bot.outbox();

  expect(discord.memberLookups).toBe(1); // only the server check
  expect(row.lastError).toBe("Skipped: no rank-up channel is set.");
});

test("an event the bot does not know is marked processed, not left in the queue", async () => {
  const { bot, store, discord, clock } = world();
  const unknown = store.enqueue("nh", { type: "goal_reached", title: "1M km" }, clock.now());
  const broken = store.enqueue("nh", { type: "job_delivered", driverName: 5 }, clock.now());

  await bot.outbox();

  expect(discord.sent).toHaveLength(0);
  expect(unknown.processedAt).not.toBeNull();
  expect(unknown.lastError).toContain("goal_reached");
  expect(broken.processedAt).not.toBeNull();
});

test("a delivery the bot only reaches a day later is not posted", async () => {
  const { bot, store, discord, clock } = world();
  const row = store.enqueue("nh", delivery(), new Date("2026-11-12T11:00:00Z"));
  clock.set("2026-11-13T12:00:00Z");

  await bot.outbox();

  expect(discord.sent).toHaveLength(0);
  expect(row.lastError).toContain("24 hours");
});

test("Discord is down: the row waits and is posted once when Discord is back", async () => {
  const { bot, store, discord, clock } = world();
  const row = store.enqueue("nh", delivery(), clock.now());
  discord.sendFailures.push({ error: down() }, { error: down() });

  await bot.outbox();
  expect(row).toMatchObject({ processedAt: null, attempts: 1 });
  expect(row.lastError).toContain("503");
  expect(row.nextAttemptAt).toEqual(new Date(clock.now().getTime() + RETRY_WAITS_MS[0]!));

  // Not yet time: the row is left alone.
  clock.advance(RETRY_WAITS_MS[0]! - 1000);
  expect(await bot.outbox()).toBe(0);

  clock.advance(1000);
  await bot.outbox(); // second try fails too
  expect(row).toMatchObject({ processedAt: null, attempts: 2 });

  clock.advance(RETRY_WAITS_MS[1]!);
  await bot.outbox(); // third try goes through
  expect(row).toMatchObject({ attempts: 3, lastError: null });
  expect(row.processedAt).not.toBeNull();
  expect(discord.sent).toHaveLength(1);
});

test("a row that keeps failing does not hold up the rows behind it", async () => {
  const { bot, store, discord, clock } = world();
  const stuck = store.enqueue("nh", delivery({ destCity: "Stuck" }), clock.now());
  discord.sendFailures.push({ error: down() });
  await bot.outbox();
  expect(stuck.processedAt).toBeNull();

  clock.advance(1000);
  const next = store.enqueue("nh", delivery({ destCity: "Next" }), clock.now());
  await bot.outbox();

  expect(next.processedAt).not.toBeNull();
  expect(discord.sent.map((s) => s.message.embed.description)).toEqual([
    expect.stringContaining("to Next"),
  ]);
});

test("after six failed tries the row is given up on, with the reason", async () => {
  const { bot, store, discord, clock } = world();
  const row = store.enqueue("nh", rankUp(), clock.now());
  for (let i = 0; i < MAX_ATTEMPTS; i++) discord.sendFailures.push({ error: down() });

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await bot.outbox();
    clock.advance(60 * 60_000);
  }

  expect(row.attempts).toBe(MAX_ATTEMPTS);
  expect(row.processedAt).not.toBeNull();
  expect(row.lastError).toMatch(/^Gave up after 6 tries: .*503/);
  expect(discord.sent).toHaveLength(0);
  // And it never comes back.
  clock.advance(24 * 60 * 60_000);
  expect(await bot.outbox()).toBe(0);
});

test("the bot dies between posting and marking: one repeat at most, then never again", async () => {
  const { bot, store, discord, clock, startBot } = world();
  const row = store.enqueue("nh", delivery(), clock.now());

  // Posted, but the write that marks the row never happens.
  store.failNext.finishOutbox = new Error("connection lost");
  await expect(bot.outbox()).rejects.toThrow("connection lost");
  expect(discord.sent).toHaveLength(1);
  expect(row).toMatchObject({ processedAt: null, attempts: 1, lastError: null });

  // A restarted bot leaves the claimed row alone for two minutes...
  const restarted = startBot();
  expect(await restarted.outbox()).toBe(0);

  // ...then gives it one last try, marking it processed before sending.
  clock.advance(CLAIM_MS);
  store.failNext.finishOutbox = new Error("would break a second normal try");
  await restarted.outbox();
  expect(discord.sent).toHaveLength(2);
  expect(row).toMatchObject({ attempts: 2, lastError: INTERRUPTED_NOTE });
  expect(row.processedAt).not.toBeNull();

  // Both posts carry the same key, so Discord itself drops a quick repeat.
  expect(discord.sent[0]!.message.dedupeKey).toBe(discord.sent[1]!.message.dedupeKey!);

  clock.advance(24 * 60 * 60_000);
  expect(await startBot().outbox()).toBe(0);
  expect(discord.sent).toHaveLength(2);
});

test("the last try is final even if it dies too", async () => {
  const { bot, store, discord, clock, startBot } = world();
  const row = store.enqueue("nh", delivery(), clock.now());
  store.failNext.finishOutbox = new Error("connection lost");
  await expect(bot.outbox()).rejects.toThrow();

  clock.advance(CLAIM_MS);
  discord.sendFailures.push({ error: down() });
  await startBot().outbox();

  expect(row.processedAt).not.toBeNull();
  expect(row.lastError).toContain(INTERRUPTED_NOTE);
  expect(row.lastError).toContain("It failed");
  clock.advance(24 * 60 * 60_000);
  expect(await startBot().outbox()).toBe(0);
  expect(discord.sent).toHaveLength(1);
});

test("no answer from Discord counts as 'maybe posted': one more try, not six", async () => {
  const { bot, store, discord, clock } = world();
  const row = store.enqueue("nh", delivery(), clock.now());
  const timeout = () => new DiscordError("no_answer", "No answer from Discord: timed out");
  // The message arrived, but the bot never heard back. Twice.
  discord.sendFailures.push(
    { error: timeout(), afterSending: true },
    { error: timeout(), afterSending: true },
  );

  await bot.outbox();
  expect(row).toMatchObject({ processedAt: null, lastError: null });

  for (let i = 0; i < 10; i++) {
    clock.advance(CLAIM_MS);
    await bot.outbox();
  }
  expect(discord.sent).toHaveLength(2);
  expect(row.processedAt).not.toBeNull();
});

test("the bot may not post in the channel: processed with the reason, and the company is told", async () => {
  const { bot, store, discord, clock } = world();
  const row = store.enqueue("nh", delivery(), clock.now());
  const refusal = "The bot lacks SendMessages in the channel #deliveries.";
  discord.sendFailures.push({ error: new DiscordError("missing_permission", refusal) });

  await bot.outbox();

  expect(row.processedAt).not.toBeNull();
  expect(row.lastError).toBe(`Not posted: ${refusal}`);
  expect(store.problems).toEqual([{ companyId: "nh", problem: refusal }]);
});

test("a driver who is not in the server: rank-up posted without a ping, roles left alone", async () => {
  const { bot, store, discord, clock } = world();
  discord.guilds.get(GUILD)!.members.delete(DRIVER);
  const row = store.enqueue("nh", rankUp(), clock.now());

  await bot.outbox();

  expect(discord.sent).toHaveLength(1);
  expect(discord.sent[0]!.message.content).toBeUndefined();
  expect(discord.roleChanges).toHaveLength(0);
  expect(row.lastError).toBe("Ingrid is not in the Discord server, so no role was changed.");
});

test("Discord down while changing roles: nothing is posted until the roles are done", async () => {
  const { bot, store, discord, clock } = world();
  const row = store.enqueue("nh", rankUp(), clock.now());
  discord.roleFailures.push(down());

  await bot.outbox();
  expect(discord.sent).toHaveLength(0);
  expect(row.processedAt).toBeNull();

  clock.advance(RETRY_WAITS_MS[0]!);
  await bot.outbox();
  expect(discord.sent).toHaveLength(1);
  expect(discord.roleChanges.map((c) => c.action)).toEqual(["add", "remove"]);
  expect(row.lastError).toBeNull();
});

test("two bots at once: only one takes a row", async () => {
  const { store, discord, clock, startBot } = world();
  store.enqueue("nh", delivery(), clock.now());
  const [a, b] = [startBot(), startBot()];

  await Promise.all([a.outbox(), b.outbox()]);

  expect(discord.sent).toHaveLength(1);
});
