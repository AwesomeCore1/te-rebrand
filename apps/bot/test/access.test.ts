// The server a company names is not trusted until one of its owners or
// managers is seen to run that server.
import { expect, test } from "bun:test";

import { Access } from "../src/access";
import { DiscordError } from "../src/discord";
import { CHANNEL, delivery, GUILD, OTHER_GUILD, OWNER, rankUp, world } from "./fakes";

test("someone else's server: nothing is posted, no role changed, and the reason is saved", async () => {
  const { bot, store, discord, clock, company } = world();
  // A manager typed in the id of a server the bot is in, but that is not theirs.
  company.discordGuildId = OTHER_GUILD;
  company.discord.deliveryChannelId = CHANNEL.elsewhere;
  company.discord.rankUpChannelId = CHANNEL.elsewhere;
  const a = store.enqueue("nh", delivery(), clock.now());
  const b = store.enqueue("nh", rankUp({ discordRoleId: "499999999999999999" }), clock.now());

  await bot.outbox();

  expect(discord.sent).toHaveLength(0);
  expect(discord.roleChanges).toHaveLength(0);
  const reason = `No owner or manager of Nordic Haulage has the Manage Server permission in the Discord server ${OTHER_GUILD}.`;
  expect(store.guildChecks.get("nh")).toEqual({ guildId: OTHER_GUILD, ok: false, reason });
  for (const row of [a, b]) {
    expect(row.processedAt).not.toBeNull();
    expect(row.lastError).toBe(`Skipped: ${reason}`);
  }
});

test("a manager who is in the server but does not run it is not enough", async () => {
  const { store, discord, clock, company } = world();
  discord.guilds.get(GUILD)!.members.get(OWNER)!.manageServer = false;
  const access = new Access({ discord, store, now: clock.now });

  const answer = await access.server(company);

  expect(answer.ok).toBe(false);
  expect(store.guildChecks.get("nh")!.ok).toBe(false);
});

test("the second of two managers running the server is enough", async () => {
  const { store, discord, clock, company } = world();
  store.managers.set("nh", ["300000000000000077", OWNER]);
  const access = new Access({ discord, store, now: clock.now });

  expect(await access.server(company)).toEqual({ ok: true, guildId: GUILD });
  expect(store.guildChecks.get("nh")).toEqual({ guildId: GUILD, ok: true, reason: null });
});

test("a server the bot is not in", async () => {
  const { store, discord, clock, company } = world();
  company.discordGuildId = "100000000000000555";
  const access = new Access({ discord, store, now: clock.now });

  expect(await access.server(company)).toEqual({
    ok: false,
    configured: true,
    reason: "The bot is not in the Discord server 100000000000000555. Invite it there first.",
  });
});

test("no owner or manager with a Discord account", async () => {
  const { store, discord, clock, company } = world();
  store.managers.set("nh", []);
  const access = new Access({ discord, store, now: clock.now });

  const answer = await access.server(company);

  expect(answer).toMatchObject({ ok: false, configured: true });
  expect(discord.memberLookups).toBe(0);
});

test("a channel in another server is refused even when the server itself is theirs", async () => {
  const { bot, store, discord, clock, company } = world();
  company.discord.deliveryChannelId = CHANNEL.elsewhere;
  const row = store.enqueue("nh", delivery(), clock.now());

  await bot.outbox();

  expect(discord.sent).toHaveLength(0);
  const reason = `Channel ${CHANNEL.elsewhere} is not in the Discord server ${GUILD}.`;
  expect(row.lastError).toBe(`Skipped: ${reason}`);
  expect(store.problems).toEqual([{ companyId: "nh", problem: reason }]);
});

test("a channel that does not exist is refused", async () => {
  const { store, discord, clock, company } = world();
  const access = new Access({ discord, store, now: clock.now });

  expect(await access.channel(company, "200000000000000555")).toEqual({
    ok: false,
    configured: true,
    reason: "Channel 200000000000000555 does not exist or the bot cannot see it.",
  });
});

test("the answer is remembered for a few minutes, then asked again", async () => {
  const { store, discord, clock, company } = world();
  const access = new Access({ discord, store, now: clock.now });

  for (let i = 0; i < 50; i++) await access.channel(company, CHANNEL.delivery);
  expect(discord.memberLookups).toBe(1);
  expect(discord.channelLookups).toBe(1);

  // The owner loses the permission. Within five minutes the bot notices.
  discord.guilds.get(GUILD)!.members.get(OWNER)!.manageServer = false;
  clock.advance(4 * 60_000);
  expect((await access.server(company)).ok).toBe(true);
  clock.advance(60_000);
  expect((await access.server(company)).ok).toBe(false);
  expect(discord.memberLookups).toBe(2);
});

test("a 'no' is remembered for a shorter time, so a fixed setup works soon", async () => {
  const { store, discord, clock, company } = world();
  discord.guilds.get(GUILD)!.members.get(OWNER)!.manageServer = false;
  const access = new Access({ discord, store, now: clock.now });
  expect((await access.server(company)).ok).toBe(false);

  discord.guilds.get(GUILD)!.members.get(OWNER)!.manageServer = true;
  clock.advance(30_000);
  expect((await access.server(company)).ok).toBe(false);
  clock.advance(30_000);
  expect((await access.server(company)).ok).toBe(true);
});

test("a changed server id is checked at once, not served from memory", async () => {
  const { store, discord, clock, company } = world();
  const access = new Access({ discord, store, now: clock.now });
  expect((await access.server(company)).ok).toBe(true);

  company.discordGuildId = OTHER_GUILD;
  expect((await access.server(company)).ok).toBe(false);
});

test("when Discord cannot be asked, nothing is decided or remembered", async () => {
  const { store, discord, clock, company } = world();
  const access = new Access({ discord, store, now: clock.now });
  discord.lookupFailures.push(new DiscordError("temporary", "Discord had a problem (503)."));

  await expect(access.server(company)).rejects.toThrow("503");
  expect(store.guildChecks.has("nh")).toBe(false);
  expect((await access.server(company)).ok).toBe(true);
});

test("a company with no server set is 'not configured', and Discord is not asked", async () => {
  const { store, discord, clock } = world();
  const solo = store.addCompany({ id: "solo" });
  const access = new Access({ discord, store, now: clock.now });

  expect(await access.server(solo)).toMatchObject({ ok: false, configured: false });
  expect(discord.memberLookups).toBe(0);
  expect(store.guildChecks.has("solo")).toBe(false);
});
