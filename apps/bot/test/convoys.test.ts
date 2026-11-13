import { expect, test } from "bun:test";

import type { TmpEvent } from "@te-rebrand/truckersmp";

import { CONVOY_KIND, reminderDue } from "../src/convoys";
import { DiscordError } from "../src/discord";
import { CHANNEL, OTHER_GUILD, world } from "./fakes";

const convoy = (id: number, meetupAt: string, name = `Convoy ${id}`): TmpEvent => ({
  id,
  name,
  game: "ets2",
  type: "Convoy",
  server: "Simulation 1",
  language: "English",
  from: { city: "Hamburg", location: null },
  to: { city: "Rotterdam", location: null },
  meetupAt: new Date(meetupAt),
  startAt: new Date(new Date(meetupAt).getTime() + 30 * 60_000),
  banner: null,
  map: null,
  description: "",
  rules: "",
  voiceLink: null,
  externalLink: null,
  vtc: { id: 7, name: "Nordic Haulage" },
  attending: { confirmed: 0, unsure: 0, vtcs: 0 },
  url: `https://truckersmp.com/events/${id}`,
});

/** A world whose TruckersMP answers from `byVtc`, as the real one would at that moment. */
function withConvoys(start: string, byVtc: Record<number, TmpEvent[]>) {
  const w = world(start);
  const asked: number[] = [];
  const upcomingConvoys = async (vtcId: number) => {
    asked.push(vtcId);
    const events = byVtc[vtcId];
    if (!events) throw new Error(`TruckersMP /vtc/${vtcId}/events: HTTP 503`);
    return events.filter((e) => e.startAt >= w.clock.now());
  };
  return { ...w, asked, bot: w.startBot({ upcomingConvoys }), upcomingConvoys };
}

const titles = (w: { discord: ReturnType<typeof world>["discord"] }) =>
  w.discord.sent.map((s) => s.message.embed.title);

test("which reminder is due when", () => {
  const event = { meetupAt: new Date("2026-11-14T18:00:00Z") };
  const at = (iso: string) => reminderDue(event, new Date(iso));
  expect(at("2026-11-13T17:59:00Z")).toBeNull(); // more than a day away
  expect(at("2026-11-13T18:00:00Z")).toBe("day");
  expect(at("2026-11-14T14:59:00Z")).toBe("day");
  expect(at("2026-11-14T15:00:00Z")).toBeNull(); // between the two
  expect(at("2026-11-14T16:59:00Z")).toBeNull();
  expect(at("2026-11-14T17:00:00Z")).toBe("hour");
  expect(at("2026-11-14T17:59:00Z")).toBe("hour");
  expect(at("2026-11-14T18:00:00Z")).toBeNull(); // it has begun
});

test("one reminder a day before and one an hour before, however often the bot looks", async () => {
  const w = withConvoys("2026-11-12T12:00:00Z", { 7: [convoy(501, "2026-11-14T18:00:00Z")] });

  // Every five minutes for three days, with a restart every round.
  const end = new Date("2026-11-15T12:00:00Z").getTime();
  const when: string[] = [];
  while (w.clock.now().getTime() < end) {
    const before = w.discord.sent.length;
    await w.startBot({ upcomingConvoys: w.upcomingConvoys }).convoys();
    if (w.discord.sent.length > before) when.push(w.clock.now().toISOString());
    w.clock.advance(5 * 60_000);
  }

  expect(titles(w)).toEqual(["Upcoming convoy: Convoy 501", "Convoy starting soon: Convoy 501"]);
  expect(when).toEqual(["2026-11-13T18:00:00.000Z", "2026-11-14T17:00:00.000Z"]);
  expect(w.discord.sent.every((s) => s.channelId === CHANNEL.events)).toBe(true);
});

test("each convoy gets its own reminders", async () => {
  const w = withConvoys("2026-11-14T17:30:00Z", {
    7: [convoy(501, "2026-11-14T18:00:00Z"), convoy(502, "2026-11-15T10:00:00Z")],
  });

  await w.bot.convoys();
  await w.bot.convoys();

  expect(titles(w)).toEqual(["Convoy starting soon: Convoy 501", "Upcoming convoy: Convoy 502"]);
});

test("a convoy announced two hours ahead gets only the last reminder", async () => {
  const w = withConvoys("2026-11-14T16:00:00Z", { 7: [convoy(501, "2026-11-14T18:00:00Z")] });

  await w.bot.convoys();
  expect(w.discord.sent).toHaveLength(0);

  w.clock.set("2026-11-14T17:05:00Z");
  await w.bot.convoys();
  expect(titles(w)).toEqual(["Convoy starting soon: Convoy 501"]);
});

test("a convoy moved to another time is announced again for the new time", async () => {
  const events = [convoy(501, "2026-11-14T18:00:00Z")];
  const w = withConvoys("2026-11-13T20:00:00Z", { 7: events });
  await w.bot.convoys();

  events[0] = convoy(501, "2026-11-14T19:30:00Z");
  await w.bot.convoys();
  await w.bot.convoys();

  expect(w.discord.sent).toHaveLength(2);
  expect(w.discord.sent[1]!.message.embed.description).toContain(
    `<t:${new Date("2026-11-14T19:30:00Z").getTime() / 1000}:F>`,
  );
});

test("only what is needed is stored: one small row per reminder, old ones removed", async () => {
  const w = withConvoys("2026-11-13T19:00:00Z", { 7: [convoy(501, "2026-11-14T18:00:00Z")] });
  await w.bot.convoys();

  expect(w.store.posts).toEqual([
    expect.objectContaining({
      companyId: "nh",
      kind: CONVOY_KIND,
      key: "501:day:2026-11-14T18:00:00.000Z",
      status: "posted",
    }),
  ]);

  w.clock.set("2027-01-15T00:00:00Z");
  await w.bot.convoys();
  expect(w.store.posts).toHaveLength(0);
});

test("companies without a verified VTC, a VTC id or an event channel get nothing", async () => {
  const w = withConvoys("2026-11-13T19:00:00Z", { 7: [convoy(501, "2026-11-14T18:00:00Z")] });
  w.company.verified = false;
  await w.bot.convoys();
  w.company.verified = true;
  w.company.truckersmpVtcId = null;
  await w.bot.convoys();
  w.company.truckersmpVtcId = 7;
  w.company.discord.eventChannelId = null;
  await w.bot.convoys();

  expect(w.discord.sent).toHaveLength(0);
  expect(w.asked).toEqual([]);
});

test("TruckersMP failing for one VTC does not stop the others", async () => {
  const w = withConvoys("2026-11-13T19:00:00Z", { 7: [convoy(501, "2026-11-14T18:00:00Z")] });
  // "aa" comes first; TruckersMP has no answer for its VTC 99.
  const other = w.store.addCompany({
    id: "aa",
    discordGuildId: OTHER_GUILD,
    truckersmpVtcId: 99,
    verified: true,
    discord: { eventChannelId: CHANNEL.elsewhere } as never,
  });
  w.store.managers.set(other.id, ["399999999999999999"]);

  await w.bot.convoys();

  expect(w.asked).toEqual([99, 7]);
  expect(titles(w)).toEqual(["Upcoming convoy: Convoy 501"]);
});

test("a server that is not theirs gets no reminder", async () => {
  const w = withConvoys("2026-11-13T19:00:00Z", { 7: [convoy(501, "2026-11-14T18:00:00Z")] });
  w.company.discordGuildId = OTHER_GUILD;
  w.company.discord.eventChannelId = CHANNEL.elsewhere;

  await w.bot.convoys();

  expect(w.discord.sent).toHaveLength(0);
  expect(w.store.posts[0]).toMatchObject({ status: "failed" });
});

test("Discord down for the day-before reminder: sent 15 minutes later, once", async () => {
  const w = withConvoys("2026-11-13T19:00:00Z", { 7: [convoy(501, "2026-11-14T18:00:00Z")] });
  w.discord.sendFailures.push({
    error: new DiscordError("temporary", "Discord had a problem (503)."),
  });

  await w.bot.convoys();
  w.clock.advance(5 * 60_000);
  await w.bot.convoys();
  expect(w.discord.sent).toHaveLength(0);

  w.clock.advance(10 * 60_000);
  await w.bot.convoys();
  w.clock.advance(5 * 60_000);
  await w.bot.convoys();
  expect(titles(w)).toEqual(["Upcoming convoy: Convoy 501"]);
});

test("the bot dies right after sending a reminder: it is not sent again", async () => {
  const w = withConvoys("2026-11-13T19:00:00Z", { 7: [convoy(501, "2026-11-14T18:00:00Z")] });
  w.store.failNext.settlePost = new Error("connection lost");

  await w.bot.convoys();
  w.clock.advance(5 * 60_000);
  await w.startBot({ upcomingConvoys: w.upcomingConvoys }).convoys();
  w.clock.advance(60 * 60_000);
  await w.startBot({ upcomingConvoys: w.upcomingConvoys }).convoys();

  expect(w.discord.sent).toHaveLength(1);
});
