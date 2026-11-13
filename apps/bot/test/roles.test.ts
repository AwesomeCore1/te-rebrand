import { expect, test } from "bun:test";

import { DiscordError } from "../src/discord";
import { delivery, DRIVER, GUILD, rankUp, ROLE, world } from "./fakes";

const rolesOf = (w: ReturnType<typeof world>) => [
  ...w.discord.guilds.get(GUILD)!.members.get(DRIVER)!.roles,
];

test("a role that is not a rank role of this company is never given or taken", async () => {
  const w = world();
  // The row names roles that exist in the server but belong to no rank
  // (a rank was edited after the row was written, or the row is forged).
  const admin = "400000000000000009";
  const mods = "400000000000000008";
  const info = { managed: false, elevated: false, aboveBot: false };
  w.discord.guilds.get(GUILD)!.roles.set(admin, { name: "Staff", ...info });
  w.discord.guilds.get(GUILD)!.roles.set(mods, { name: "Mods", ...info });
  w.discord.guilds.get(GUILD)!.members.get(DRIVER)!.roles.add(mods);
  const row = w.store.enqueue(
    "nh",
    rankUp({ discordRoleId: admin, previousDiscordRoleId: mods }),
    w.clock.now(),
  );

  await w.bot.outbox();

  expect(w.discord.roleChanges).toHaveLength(0);
  expect(rolesOf(w)).toEqual([ROLE.rookie, mods]);
  expect(row.lastError).toContain(`Role ${admin} is not the role of any rank of Nordic Haulage`);
  // The rank-up itself is still announced.
  expect(w.discord.sent).toHaveLength(1);
});

test("another company's rank role is not this company's", async () => {
  const w = world();
  w.store.rankRoles.set("other", ["400000000000000050"]);
  w.store.enqueue("nh", rankUp({ discordRoleId: "400000000000000050" }), w.clock.now());

  await w.bot.outbox();

  expect(w.discord.roleChanges).toHaveLength(0);
});

test("the bot's role is below the rank role: a clear reason, the old role stays, no crash", async () => {
  const w = world();
  w.discord.guilds.get(GUILD)!.roles.get(ROLE.veteran)!.aboveBot = true;
  const row = w.store.enqueue("nh", rankUp(), w.clock.now());

  await w.bot.outbox();

  const reason =
    "The bot's own role is below the role \"Veteran\". In Server Settings > Roles, drag the bot's role above the rank roles.";
  expect(row.processedAt).not.toBeNull();
  expect(row.lastError).toBe(reason);
  expect(w.store.problems).toEqual([{ companyId: "nh", problem: reason }]);
  expect(w.discord.roleChanges).toHaveLength(0);
  expect(rolesOf(w)).toEqual([ROLE.rookie]);
  expect(w.discord.sent).toHaveLength(1);
});

test("the bot lacks Manage Roles: recorded, the rank-up is still posted", async () => {
  const w = world();
  w.discord.guilds.get(GUILD)!.botCanManageRoles = false;
  const row = w.store.enqueue("nh", rankUp(), w.clock.now());

  await w.bot.outbox();

  expect(row.lastError).toBe("The bot lacks the Manage Roles permission.");
  expect(w.store.problems).toHaveLength(1);
  expect(w.discord.sent).toHaveLength(1);
  // It was told no once and did not go on to try taking the old role.
  expect(w.discord.roleChanges).toHaveLength(0);
});

test("a rank role with admin or moderation permissions is not handed out", async () => {
  const w = world();
  w.discord.guilds.get(GUILD)!.roles.get(ROLE.veteran)!.elevated = true;
  const row = w.store.enqueue("nh", rankUp(), w.clock.now());

  await w.bot.outbox();

  expect(w.discord.roleChanges).toHaveLength(0);
  expect(row.lastError).toContain("carries moderation or admin permissions");
});

test("a role managed by an integration, and a role that was deleted", async () => {
  const w = world();
  w.discord.guilds.get(GUILD)!.roles.get(ROLE.veteran)!.managed = true;
  const managed = w.store.enqueue("nh", rankUp(), w.clock.now());
  await w.bot.outbox();
  expect(managed.lastError).toContain("managed by Discord or an integration");

  w.discord.guilds.get(GUILD)!.roles.delete(ROLE.veteran);
  const deleted = w.store.enqueue("nh", rankUp(), w.clock.now());
  await w.bot.outbox();
  expect(deleted.lastError).toBe(`Role ${ROLE.veteran} does not exist in the Discord server.`);
  expect(w.discord.roleChanges).toHaveLength(0);
});

test("a new rank without a role still takes the previous rank's role", async () => {
  const w = world();
  w.store.enqueue("nh", rankUp({ discordRoleId: null }), w.clock.now());

  await w.bot.outbox();

  expect(w.discord.roleChanges).toEqual([
    { action: "remove", guildId: GUILD, userId: DRIVER, roleId: ROLE.rookie },
  ]);
});

test("a driver without a linked Discord account: roles left alone, rank-up posted", async () => {
  const w = world();
  w.store.drivers.set("ingrid", { name: "Ingrid", discordId: null });
  const row = w.store.enqueue("nh", rankUp(), w.clock.now());

  await w.bot.outbox();

  expect(w.discord.roleChanges).toHaveLength(0);
  expect(row.lastError).toBe("Ingrid has no Discord account linked, so no role was changed.");
  expect(w.discord.sent[0]!.message.content).toBeUndefined();
});

test("on the sixth try the rank-up is posted even if roles still cannot be changed", async () => {
  const w = world();
  const row = w.store.enqueue("nh", rankUp(), w.clock.now());
  for (let i = 0; i < 6; i++) {
    w.discord.roleFailures.push(new DiscordError("temporary", "Discord had a problem (503)."));
  }

  for (let i = 0; i < 6; i++) {
    await w.bot.outbox();
    w.clock.advance(60 * 60_000);
  }

  expect(w.discord.sent).toHaveLength(1);
  expect(row.processedAt).not.toBeNull();
  expect(row.lastError).toContain("503");
});

test("deliveries never touch roles", async () => {
  const w = world();
  w.store.enqueue("nh", delivery(), w.clock.now());
  await w.bot.outbox();
  expect(w.discord.roleChanges).toHaveLength(0);
});
