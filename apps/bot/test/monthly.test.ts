import { expect, test } from "bun:test";

import { DiscordError } from "../src/discord";
import { monthDue, MONTHLY_KIND } from "../src/monthly";
import { CHANNEL, OTHER_GUILD, world } from "./fakes";

/** October 2026 for Nordic Haulage: Ingrid ahead of Dale, Kasper, then Mette. */
function october(w: ReturnType<typeof world>) {
  w.store.drivers.set("dale", { name: "Dale", discordId: null });
  w.store.drivers.set("kasper", { name: "Kasper", discordId: null });
  w.store.drivers.set("mette", { name: "Mette", discordId: null });
  const job = (driverId: string, km: number, day: string, extra = {}) =>
    w.store.jobs.push({
      companyId: "nh",
      driverId,
      game: "ets2",
      km,
      finishedAt: new Date(day),
      ...extra,
    });
  job("ingrid", 1200, "2026-10-03T10:00:00Z");
  job("ingrid", 800, "2026-10-31T23:59:59Z"); // last second of the month counts
  job("dale", 1500, "2026-10-10T10:00:00Z", { game: "ats" });
  job("kasper", 900, "2026-10-12T10:00:00Z");
  job("mette", 300, "2026-10-12T10:00:00Z");
  // None of these count for October:
  job("mette", 9000, "2026-09-30T23:59:59Z");
  job("mette", 9000, "2026-11-01T00:00:00Z");
  job("mette", 9000, "2026-10-05T10:00:00Z", { status: "cancelled" });
  job("mette", 9000, "2026-10-05T10:00:00Z", { status: "flagged" });
  w.store.jobs.push({
    companyId: "other",
    driverId: "mette",
    game: "ets2",
    km: 9000,
    finishedAt: new Date("2026-10-05T10:00:00Z"),
  });
}

test("which month is due, and when", () => {
  // Not before 00:15 UTC on the 1st.
  expect(monthDue(new Date("2026-10-31T23:59:00Z"))).toBeNull();
  expect(monthDue(new Date("2026-11-01T00:14:59Z"))).toBeNull();
  expect(monthDue(new Date("2026-11-01T00:15:00Z"))).toEqual({
    key: "2026-10",
    label: "October 2026",
    from: new Date("2026-10-01T00:00:00Z"),
    to: new Date("2026-11-01T00:00:00Z"),
  });
  // Still made up for on the 3rd, not after.
  expect(monthDue(new Date("2026-11-03T23:59:00Z"))?.key).toBe("2026-10");
  expect(monthDue(new Date("2026-11-04T00:00:00Z"))).toBeNull();
  expect(monthDue(new Date("2026-11-13T12:00:00Z"))).toBeNull();
  // December's results are posted in January of the next year.
  expect(monthDue(new Date("2027-01-01T06:00:00Z"))).toMatchObject({
    key: "2026-12",
    label: "December 2026",
    from: new Date("2026-12-01T00:00:00Z"),
    to: new Date("2027-01-01T00:00:00Z"),
  });
});

test("the top three of last month, by delivered distance, in the monthly channel", async () => {
  const w = world("2026-11-01T00:20:00Z");
  october(w);

  await w.bot.monthly();

  expect(w.discord.sent).toHaveLength(1);
  expect(w.discord.sent[0]!.channelId).toBe(CHANNEL.monthly);
  expect(w.discord.sent[0]!.message.embed).toMatchObject({
    title: "October 2026: top drivers",
    description: [
      "1. **Ingrid**: 2,000 km in 2 jobs",
      "2. **Dale**: 1,500 km (932 mi) in 1 job",
      "3. **Kasper**: 900 km in 1 job",
    ].join("\n"),
  });
});

test("posted exactly once: not on later rounds, not after restarts, not next week", async () => {
  const w = world("2026-11-01T00:20:00Z");
  october(w);

  for (let i = 0; i < 5; i++) {
    await w.bot.monthly();
    w.clock.advance(5 * 60_000);
  }
  // Restarts on the 1st, 2nd and 3rd.
  for (const at of ["2026-11-01T09:00:00Z", "2026-11-02T09:00:00Z", "2026-11-03T09:00:00Z"]) {
    w.clock.set(at);
    await w.startBot().monthly();
  }
  w.clock.set("2026-11-10T09:00:00Z");
  await w.startBot().monthly();

  expect(w.discord.sent).toHaveLength(1);
  expect(w.store.posts).toMatchObject([
    { companyId: "nh", kind: MONTHLY_KIND, key: "2026-10", status: "posted" },
  ]);
});

test("the next month is posted on its own", async () => {
  const w = world("2026-11-01T00:20:00Z");
  october(w);
  await w.bot.monthly();
  w.store.jobs.push({
    companyId: "nh",
    driverId: "ingrid",
    game: "ets2",
    km: 500,
    finishedAt: new Date("2026-11-20T10:00:00Z"),
  });

  w.clock.set("2026-12-01T00:20:00Z");
  await w.bot.monthly();
  await w.bot.monthly();

  expect(w.discord.sent.map((s) => s.message.embed.title)).toEqual([
    "October 2026: top drivers",
    "November 2026: top drivers",
  ]);
});

test("a bot that was down on the 1st posts on the 2nd", async () => {
  const w = world("2026-11-02T14:00:00Z");
  october(w);
  await w.bot.monthly();
  expect(w.discord.sent).toHaveLength(1);
});

test("nothing outside the first days of the month", async () => {
  const w = world("2026-11-13T12:00:00Z");
  october(w);
  await w.bot.monthly();
  expect(w.discord.sent).toHaveLength(0);
  expect(w.store.posts).toHaveLength(0);
});

test("two bots at the same moment: one post", async () => {
  const w = world("2026-11-01T00:20:00Z");
  october(w);
  await Promise.all([w.startBot().monthly(), w.startBot().monthly(), w.startBot().monthly()]);
  expect(w.discord.sent).toHaveLength(1);
});

test("the bot dies right after sending: the month is not posted again", async () => {
  const w = world("2026-11-01T00:20:00Z");
  october(w);
  w.store.failNext.settlePost = new Error("connection lost");

  await w.bot.monthly(); // sent, but the outcome was never written
  expect(w.discord.sent).toHaveLength(1);
  expect(w.store.posts[0]!.status).toBe("pending");

  for (const at of ["2026-11-01T02:00:00Z", "2026-11-02T02:00:00Z", "2026-11-03T02:00:00Z"]) {
    w.clock.set(at);
    await w.startBot().monthly();
  }
  expect(w.discord.sent).toHaveLength(1);
});

test("Discord is down: tried again an hour later, and then only once", async () => {
  const w = world("2026-11-01T00:20:00Z");
  october(w);
  w.discord.sendFailures.push({
    error: new DiscordError("temporary", "Discord had a problem (503)."),
  });

  await w.bot.monthly();
  expect(w.discord.sent).toHaveLength(0);
  expect(w.store.posts[0]).toMatchObject({
    status: "failed",
    detail: expect.stringContaining("503"),
  });

  w.clock.advance(30 * 60_000);
  await w.bot.monthly(); // too soon
  expect(w.discord.sent).toHaveLength(0);

  w.clock.advance(30 * 60_000);
  await w.bot.monthly();
  await w.bot.monthly();
  expect(w.discord.sent).toHaveLength(1);
  expect(w.store.posts[0]!.status).toBe("posted");
});

test("no answer from Discord: it may have arrived, so it is not sent again", async () => {
  const w = world("2026-11-01T00:20:00Z");
  october(w);
  w.discord.sendFailures.push({
    error: new DiscordError("no_answer", "No answer from Discord: timed out"),
    afterSending: true,
  });

  await w.bot.monthly();
  w.clock.set("2026-11-02T09:00:00Z");
  await w.bot.monthly();

  expect(w.discord.sent).toHaveLength(1);
  expect(w.store.posts[0]!.status).toBe("unknown");
});

test("a month without delivered jobs: no post, and no asking again", async () => {
  const w = world("2026-11-01T00:20:00Z");

  await w.bot.monthly();
  await w.bot.monthly();

  expect(w.discord.sent).toHaveLength(0);
  expect(w.store.posts).toMatchObject([{ status: "skipped" }]);
});

test("only companies with a monthly channel, each with its own drivers", async () => {
  const w = world("2026-11-01T00:20:00Z");
  october(w);
  w.store.addCompany({ id: "nochannel", discordGuildId: OTHER_GUILD });
  w.store.addCompany({ id: "noserver", discord: { monthlyChannelId: CHANNEL.monthly } as never });

  await w.bot.monthly();

  expect(w.discord.sent).toHaveLength(1);
  expect(w.store.posts.map((p) => p.companyId)).toEqual(["nh"]);
});

test("a server that is not theirs: no post, the reason saved, asked again an hour later", async () => {
  const w = world("2026-11-01T00:20:00Z");
  october(w);
  w.company.discordGuildId = OTHER_GUILD;
  w.company.discord.monthlyChannelId = CHANNEL.elsewhere;

  await w.bot.monthly();

  expect(w.discord.sent).toHaveLength(0);
  expect(w.store.posts[0]).toMatchObject({
    status: "failed",
    detail: expect.stringContaining("Manage Server"),
  });
  expect(w.store.guildChecks.get("nh")!.ok).toBe(false);
});

test("one company's failure does not stop the next company", async () => {
  const w = world("2026-11-01T00:20:00Z");
  october(w);
  // "aa" comes first and its lookup blows up.
  const broken = w.store.addCompany({
    id: "aa",
    discordGuildId: "100000000000000777",
    discord: { monthlyChannelId: "200000000000000777" } as never,
  });
  w.store.managers.set(broken.id, ["300000000000000777"]);
  w.discord.lookupFailures.push(new Error("something unexpected"));

  await w.bot.monthly();

  expect(w.discord.sent).toHaveLength(1);
});
