// `rank_roles_sync`: one member's rank roles are brought in line with the
// database. The role of the rank they hold is given, every other rank role of
// the company is taken, nothing else is touched and nothing is posted.
import { expect, test } from "bun:test";

import { ROLE_SYNC_BATCH } from "../src/bot";
import { DiscordError } from "../src/discord";
import { MAX_ATTEMPTS, RETRY_WAITS_MS } from "../src/outbox";
import { delivery, DRIVER, GUILD, OTHER_GUILD, OWNER, ROLE, roleSync, world } from "./fakes";

const PLAIN = { managed: false, elevated: false, aboveBot: false };
/** Roles in the server that belong to no rank of Nordic Haulage. */
const STAFF = "400000000000000009";
const THEIRS = "400000000000000050";

const guild = (w: ReturnType<typeof world>) => w.discord.guilds.get(GUILD)!;
const rolesOf = (w: ReturnType<typeof world>, userId = DRIVER) =>
  [...guild(w).members.get(userId)!.roles].sort();
const hold = (w: ReturnType<typeof world>, ...roles: string[]) => {
  guild(w).members.get(DRIVER)!.roles = new Set(roles);
};
const changes = (w: ReturnType<typeof world>) =>
  w.discord.roleChanges.map((c) => [c.action, c.roleId]);

test("a new member gets the role of the rank they start at, and nothing is posted", async () => {
  const w = world();
  hold(w);
  const row = w.store.enqueue("nh", roleSync(), w.clock.now());

  expect(await w.bot.roleSync()).toBe(1);

  expect(changes(w)).toEqual([["add", ROLE.rookie]]);
  expect(w.discord.roleChanges[0]).toMatchObject({ guildId: GUILD, userId: DRIVER });
  expect(w.discord.sent).toHaveLength(0);
  expect(row).toMatchObject({ processedAt: w.clock.now(), attempts: 1, lastError: null });
  // Done: the next rounds find nothing.
  expect(await w.bot.roleSync()).toBe(0);
});

test("a member who is already right costs one lookup and changes nothing", async () => {
  const w = world(); // Ingrid is a Rookie and holds the Rookie role
  const row = w.store.enqueue("nh", roleSync(), w.clock.now());

  await w.bot.roleSync();

  expect(w.discord.roleChanges).toHaveLength(0);
  expect(w.discord.roleLookups).toBe(1);
  expect(row.lastError).toBeNull();
  expect(row.processedAt).not.toBeNull();
});

test("the role comes from the database when the row is handled, not from the row", async () => {
  const w = world();
  // Written when Ingrid was a Rookie; by the time the bot gets to it she is a Veteran.
  w.store.enqueue("nh", roleSync({ reason: "ranks_changed" }), w.clock.now());
  w.store.setRank("nh", "ingrid", "Veteran", ROLE.veteran);

  await w.bot.roleSync();

  expect(changes(w)).toEqual([
    ["add", ROLE.veteran],
    ["remove", ROLE.rookie],
  ]);
  expect(rolesOf(w)).toEqual([ROLE.veteran]);
});

test("a rank without a role: every rank role is taken, none given", async () => {
  const w = world();
  hold(w, ROLE.rookie, ROLE.veteran);
  w.store.setRank("nh", "ingrid", "Elite", null);
  w.store.enqueue("nh", roleSync({ reason: "ranks_changed" }), w.clock.now());

  await w.bot.roleSync();

  expect(rolesOf(w)).toEqual([]);
});

for (const reason of ["left", "removed", "inactive"] as const) {
  test(`someone who ${reason === "inactive" ? "was set inactive" : reason} loses every rank role, and only those`, async () => {
    const w = world();
    guild(w).roles.set(STAFF, { name: "Staff", ...PLAIN });
    hold(w, ROLE.rookie, ROLE.veteran, STAFF);
    w.store.rankTargets.delete("nh:ingrid"); // no longer an active member
    const row = w.store.enqueue("nh", roleSync({ reason }), w.clock.now());

    await w.bot.roleSync();

    expect(rolesOf(w)).toEqual([STAFF]);
    expect(w.discord.roleChanges.every((c) => c.action === "remove")).toBe(true);
    expect(w.discord.sent).toHaveLength(0);
    expect(row.lastError).toBeNull();
  });
}

test("a role that is not a rank's role in this company is never touched", async () => {
  const w = world();
  // Staff belongs to no rank; THEIRS is a rank role of another company on Tacho.
  guild(w).roles.set(STAFF, { name: "Staff", ...PLAIN });
  guild(w).roles.set(THEIRS, { name: "Their rank", ...PLAIN });
  w.store.rankRoles.set("other", [THEIRS]);
  hold(w, ROLE.rookie, STAFF, THEIRS);

  // As a member whose rank moved...
  w.store.setRank("nh", "ingrid", "Veteran", ROLE.veteran);
  w.store.enqueue("nh", roleSync({ reason: "ranks_changed" }), w.clock.now());
  await w.bot.roleSync();
  expect(rolesOf(w)).toEqual([ROLE.veteran, STAFF, THEIRS].sort());

  // ...and after leaving.
  w.store.rankTargets.delete("nh:ingrid");
  w.store.enqueue("nh", roleSync({ reason: "left" }), w.clock.now());
  await w.bot.roleSync();
  expect(rolesOf(w)).toEqual([STAFF, THEIRS].sort());

  const touched = new Set(w.discord.roleChanges.map((c) => c.roleId));
  expect([...touched].sort()).toEqual([ROLE.rookie, ROLE.veteran]);
});

test("a row cannot name a role to give", async () => {
  const w = world();
  guild(w).roles.set(STAFF, { name: "Staff", ...PLAIN });
  hold(w);
  // A forged or outdated row: fields the bot does not read for a sync.
  w.store.enqueue(
    "nh",
    { ...roleSync(), discordRoleId: STAFF, give: STAFF, want: STAFF },
    w.clock.now(),
  );

  await w.bot.roleSync();

  expect(rolesOf(w)).toEqual([ROLE.rookie]);
});

test("the rank the database gives is still checked: a role that is no rank's is not given", async () => {
  const w = world();
  guild(w).roles.set(STAFF, { name: "Staff", ...PLAIN });
  // The store hands back a role the company's ranks do not have.
  w.store.setRank("nh", "ingrid", "Veteran", STAFF);
  const row = w.store.enqueue("nh", roleSync(), w.clock.now());

  await w.bot.roleSync();

  expect(w.discord.roleChanges).toHaveLength(0);
  expect(rolesOf(w)).toEqual([ROLE.rookie]);
  expect(row.lastError).toContain(`Role ${STAFF} is not the role of any rank of Nordic Haulage`);
});

test("a role a rank just stopped using is taken, and never given", async () => {
  const w = world();
  const OLD = "400000000000000007";
  guild(w).roles.set(OLD, { name: "Old Veteran", ...PLAIN });
  // The Veteran rank's role was replaced: OLD is no rank's role any more.
  w.store.setRank("nh", "ingrid", "Veteran", ROLE.veteran);
  hold(w, OLD);
  w.store.enqueue(
    "nh",
    roleSync({ reason: "ranks_changed", retiredRoleIds: [OLD] }),
    w.clock.now(),
  );

  await w.bot.roleSync();

  expect(changes(w)).toEqual([
    ["add", ROLE.veteran],
    ["remove", OLD],
  ]);

  // Someone who does not hold it is not given it, and is not asked about it.
  const other = world();
  guild(other).roles.set(OLD, { name: "Old Veteran", ...PLAIN });
  other.store.enqueue("nh", roleSync({ retiredRoleIds: [OLD] }), other.clock.now());
  await other.bot.roleSync();
  expect(other.discord.roleChanges).toHaveLength(0);
});

test("a retired role with admin or moderation permissions is left alone, with the reason", async () => {
  const w = world();
  const MODS = "400000000000000008";
  guild(w).roles.set(MODS, { name: "Mods", ...PLAIN, elevated: true });
  hold(w, ROLE.rookie, MODS);
  const row = w.store.enqueue("nh", roleSync({ retiredRoleIds: [MODS] }), w.clock.now());

  await w.bot.roleSync();

  expect(w.discord.roleChanges).toHaveLength(0);
  expect(rolesOf(w)).toEqual([ROLE.rookie, MODS].sort());
  expect(row.lastError).toContain("carries moderation or admin permissions");
  expect(w.store.problems).toHaveLength(1);
});

test("a server the company does not run: nothing is changed there", async () => {
  const w = world();
  // The company names somebody else's server, where the driver happens to be.
  w.company.discordGuildId = OTHER_GUILD;
  const theirs = w.discord.guilds.get(OTHER_GUILD)!;
  theirs.members.set(DRIVER, { manageServer: false, roles: new Set([ROLE.veteran]) });
  theirs.roles.set(ROLE.rookie, { name: "Rookie", ...PLAIN });
  const row = w.store.enqueue("nh", roleSync(), w.clock.now());

  await w.bot.roleSync();

  expect(w.discord.roleChanges).toHaveLength(0);
  expect(w.discord.roleLookups).toBe(0);
  expect([...theirs.members.get(DRIVER)!.roles]).toEqual([ROLE.veteran]);
  expect(row.processedAt).not.toBeNull();
  expect(row.lastError).toBe(
    `Skipped: No owner or manager of Nordic Haulage has the Manage Server permission in the Discord server ${OTHER_GUILD}.`,
  );
  expect(w.store.guildChecks.get("nh")).toMatchObject({ guildId: OTHER_GUILD, ok: false });
});

test("a server the bot is not in, and a company without a server", async () => {
  const w = world();
  w.company.discordGuildId = "100000000000000777";
  const gone = w.store.enqueue("nh", roleSync(), w.clock.now());
  w.store.addCompany({ id: "solo", name: "No Discord Ltd" });
  w.store.rankRoles.set("solo", [ROLE.rookie]);
  const unset = w.store.enqueue("solo", roleSync(), w.clock.now());

  await w.bot.roleSync();

  expect(w.discord.roleChanges).toHaveLength(0);
  expect(gone.lastError).toContain("The bot is not in the Discord server 100000000000000777");
  expect(unset.lastError).toBe("Skipped: the company has no Discord server set.");
  expect(gone.processedAt).not.toBeNull();
  expect(unset.processedAt).not.toBeNull();
});

test("a company whose ranks have no roles is skipped without asking Discord anything", async () => {
  const w = world();
  w.store.rankRoles.set("nh", []);
  const row = w.store.enqueue("nh", roleSync(), w.clock.now());

  await w.bot.roleSync();

  expect(row.lastError).toBe("Skipped: no rank of Nordic Haulage has a Discord role.");
  expect(w.discord.memberLookups + w.discord.roleLookups).toBe(0);
});

test("a member who is not in the server is skipped with the reason, once", async () => {
  const w = world();
  guild(w).members.delete(DRIVER);
  const row = w.store.enqueue("nh", roleSync(), w.clock.now());

  await w.bot.roleSync();

  expect(w.discord.roleChanges).toHaveLength(0);
  expect(row).toMatchObject({ attempts: 1, processedAt: w.clock.now() });
  expect(row.lastError).toBe(
    "Skipped: Ingrid is not in the Discord server, so no role was changed.",
  );
  // Not a setup problem, so not on the company's settings screen...
  expect(w.store.problems).toHaveLength(0);
  // ...and never tried again.
  w.clock.advance(24 * 60 * 60_000);
  expect(await w.bot.roleSync()).toBe(0);
});

test("a member without a linked Discord account is skipped with the reason", async () => {
  const w = world();
  w.store.drivers.set("ingrid", { name: "Ingrid", discordId: null });
  const row = w.store.enqueue("nh", roleSync(), w.clock.now());

  await w.bot.roleSync();

  expect(row.processedAt).not.toBeNull();
  expect(row.lastError).toBe(
    "Skipped: Ingrid has no Discord account linked, so no role was changed.",
  );
  expect(w.discord.roleLookups).toBe(0);
});

test("the bot's role is below the rank role: the reason is recorded and the old role stays", async () => {
  const w = world();
  guild(w).roles.get(ROLE.veteran)!.aboveBot = true;
  w.store.setRank("nh", "ingrid", "Veteran", ROLE.veteran);
  const row = w.store.enqueue("nh", roleSync({ reason: "ranks_changed" }), w.clock.now());

  await w.bot.roleSync();

  const reason =
    "The bot's own role is below the role \"Veteran\". In Server Settings > Roles, drag the bot's role above the rank roles.";
  expect(row.lastError).toBe(reason);
  expect(row.processedAt).not.toBeNull();
  expect(w.store.problems).toEqual([{ companyId: "nh", problem: reason }]);
  // Better the previous rank's role than none.
  expect(rolesOf(w)).toEqual([ROLE.rookie]);
});

test("the bot lacks Manage Roles: recorded, not retried", async () => {
  const w = world();
  guild(w).botCanManageRoles = false;
  hold(w);
  const row = w.store.enqueue("nh", roleSync(), w.clock.now());

  await w.bot.roleSync();

  expect(row.lastError).toBe("The bot lacks the Manage Roles permission.");
  expect(row.processedAt).not.toBeNull();
  expect(w.store.problems).toHaveLength(1);
});

test("Discord is down: the sync waits and is finished when Discord is back", async () => {
  const w = world();
  w.store.setRank("nh", "ingrid", "Veteran", ROLE.veteran);
  const row = w.store.enqueue("nh", roleSync({ reason: "ranks_changed" }), w.clock.now());
  w.discord.roleFailures.push(new DiscordError("temporary", "Discord had a problem (503)."));

  await w.bot.roleSync();
  expect(row).toMatchObject({ processedAt: null, attempts: 1 });
  expect(row.lastError).toContain("503");
  expect(rolesOf(w)).toEqual([ROLE.rookie]);

  // Not yet time: the row is left alone.
  w.clock.advance(RETRY_WAITS_MS[0]! - 1000);
  expect(await w.bot.roleSync()).toBe(0);

  w.clock.advance(1000);
  await w.bot.roleSync();
  expect(rolesOf(w)).toEqual([ROLE.veteran]);
  expect(row).toMatchObject({ attempts: 2, lastError: null });
  expect(row.processedAt).not.toBeNull();
  expect(w.discord.sent).toHaveLength(0);
});

test("a sync that keeps failing is given up on after six tries", async () => {
  const w = world();
  hold(w);
  const row = w.store.enqueue("nh", roleSync(), w.clock.now());
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    w.discord.roleFailures.push(new DiscordError("temporary", "Discord had a problem (503)."));
  }

  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    await w.bot.roleSync();
    w.clock.advance(60 * 60_000);
  }

  expect(row.attempts).toBe(MAX_ATTEMPTS);
  expect(row.processedAt).not.toBeNull();
  expect(row.lastError).toMatch(/^Gave up after 6 tries: .*503/);
  expect(await w.bot.roleSync()).toBe(0);
});

test("syncs and posts are separate lanes: neither loop takes the other's rows", async () => {
  const w = world();
  hold(w);
  const sync = w.store.enqueue("nh", roleSync(), w.clock.now());
  const post = w.store.enqueue("nh", delivery(), w.clock.now());

  expect(await w.bot.outbox()).toBe(1);
  expect(post.processedAt).not.toBeNull();
  expect(sync.processedAt).toBeNull();
  expect(w.discord.roleChanges).toHaveLength(0);

  expect(await w.bot.roleSync()).toBe(1);
  expect(sync.processedAt).not.toBeNull();
  expect(w.discord.sent).toHaveLength(1);
});

test("a ladder change in a big company does not hold up the delivery feed", async () => {
  const w = world();
  // 120 members, each with a sync waiting, all older than the delivery.
  for (let i = 0; i < 120; i++) {
    const userId = `3000000000000001${String(i).padStart(2, "0")}`;
    w.store.drivers.set(`d${i}`, { name: `Driver ${i}`, discordId: userId });
    w.store.setRank("nh", `d${i}`, "Rookie", ROLE.rookie);
    guild(w).members.set(userId, { manageServer: false, roles: new Set() });
    w.store.enqueue(
      "nh",
      roleSync({ driverId: `d${i}`, driverName: `Driver ${i}`, reason: "ranks_changed" }),
      new Date("2026-11-13T11:00:00Z"),
    );
  }
  w.store.enqueue("nh", delivery(), w.clock.now());

  // The delivery goes out in the first round of the posts loop.
  expect(await w.bot.outbox()).toBe(1);
  expect(w.discord.sent).toHaveLength(1);

  // The syncs go through a batch at a time.
  expect(await w.bot.roleSync()).toBe(ROLE_SYNC_BATCH);
  expect(w.discord.roleChanges).toHaveLength(ROLE_SYNC_BATCH);
  for (let round = 0; round < 120 / ROLE_SYNC_BATCH; round++) await w.bot.roleSync();
  expect(w.discord.roleChanges).toHaveLength(120);
  expect(w.store.outbox.every((r) => r.processedAt !== null)).toBe(true);
  // The owner, who is not a driver in any of this, was never touched.
  expect(rolesOf(w, OWNER)).toEqual([]);
});

test("the bot stops between changing roles and writing it down: the repeat changes nothing more", async () => {
  const w = world();
  hold(w);
  const row = w.store.enqueue("nh", roleSync(), w.clock.now());
  w.store.failNext.finishOutbox = new Error("connection lost");

  await expect(w.bot.roleSync()).rejects.toThrow("connection lost");
  expect(rolesOf(w)).toEqual([ROLE.rookie]);
  expect(row.processedAt).toBeNull();

  w.clock.advance(2 * 60_000);
  await w.startBot().roleSync();
  expect(row.processedAt).not.toBeNull();
  expect(changes(w)).toEqual([["add", ROLE.rookie]]);
});
