import { expect, test } from "bun:test";

import type { TmpEvent } from "@te-rebrand/truckersmp";

import { distance, km, miles, money, plain } from "../src/format";
import {
  convoyReminderMessage,
  deliveryMessage,
  monthlyMessage,
  rankUpMessage,
} from "../src/messages";
import { delivery, rankUp } from "./fakes";

test("km always, miles alongside only for ATS", () => {
  expect(distance(1196, "ets2")).toBe("1,196 km");
  expect(distance(598, "ats")).toBe("598 km (372 mi)");
  // 1 mi = 1.609344 km exactly
  expect(miles(1609.344)).toBe("1,000 mi");
  expect(km(8.44)).toBe("8.4 km");
  expect(km(0)).toBe("0 km");
});

test("income is EUR in ETS2 and USD in ATS", () => {
  expect(money(24310, "ets2")).toBe("€24,310");
  expect(money(24310, "ats")).toBe("$24,310");
});

test("an ETS2 delivery", () => {
  expect(deliveryMessage(delivery())).toEqual({
    embed: {
      description: "**Ingrid** delivered Electronics from Hamburg to Lyon.",
      fields: [
        { name: "Distance", value: "1,196 km", inline: true },
        { name: "Income", value: "€24,310", inline: true },
        { name: "Game", value: "ETS2, TruckersMP", inline: true },
      ],
      color: 0x2f63c4,
    },
  });
});

test("an ATS delivery shows miles and dollars", () => {
  const { embed } = deliveryMessage(
    delivery({
      game: "ats",
      multiplayer: false,
      sourceCity: "Los Angeles",
      destCity: "Phoenix",
      drivenKm: 598,
      income: 9120,
    }),
  );
  expect(embed.description).toBe("**Ingrid** delivered Electronics from Los Angeles to Phoenix.");
  expect(embed.fields?.map((f) => f.value)).toEqual([
    "598 km (372 mi)",
    "$9,120",
    "ATS, singleplayer",
  ]);
});

test("a rank-up pings the driver and nobody else", () => {
  const message = rankUpMessage(rankUp(), "Nordic Haulage", "42");
  expect(message.content).toBe("<@42>");
  expect(message.mentionUserIds).toEqual(["42"]);
  expect(message.embed.description).toBe("**Ingrid** reached the rank **Veteran**.");
  expect(message.embed.fields).toEqual([
    { name: "Distance for Nordic Haulage", value: "25,012 km" },
  ]);
});

test("a rank-up for someone who is not in the server pings nobody", () => {
  const message = rankUpMessage(rankUp(), "Nordic Haulage", null);
  expect(message.content).toBeUndefined();
  expect(message.mentionUserIds).toBeUndefined();
});

test("monthly winners: three lines, miles for a driver who mostly drove ATS", () => {
  const message = monthlyMessage("October 2026", [
    { driverId: "a", driverName: "Ingrid", km: 12340.4, atsKm: 0, jobs: 14 },
    { driverId: "b", driverName: "Dale", km: 9800, atsKm: 9000, jobs: 11 },
    { driverId: "c", driverName: "Kasper", km: 412, atsKm: 100, jobs: 1 },
  ]);
  expect(message.embed.title).toBe("October 2026: top drivers");
  expect(message.embed.description).toBe(
    [
      "1. **Ingrid**: 12,340 km in 14 jobs",
      "2. **Dale**: 9,800 km (6,089 mi) in 11 jobs",
      "3. **Kasper**: 412 km in 1 job",
    ].join("\n"),
  );
  expect(message.content).toBeUndefined();
});

const convoy: TmpEvent = {
  id: 501,
  name: "Friday Night Run",
  game: "ets2",
  type: "Convoy",
  server: "Simulation 1",
  language: "English",
  from: { city: "Hamburg", location: "Garage" },
  to: { city: "Rotterdam", location: "Port" },
  meetupAt: new Date("2026-11-14T18:00:00Z"),
  startAt: new Date("2026-11-14T18:30:00Z"),
  banner: null,
  map: null,
  description: "",
  rules: "",
  voiceLink: null,
  externalLink: null,
  vtc: { id: 7, name: "Nordic Haulage" },
  attending: { confirmed: 12, unsure: 3, vtcs: 2 },
  url: "https://truckersmp.com/events/501-friday-night-run",
};

test("a convoy reminder gives the times in the reader's own time zone and links to TruckersMP", () => {
  const meetup = Math.floor(convoy.meetupAt.getTime() / 1000);
  const start = Math.floor(convoy.startAt.getTime() / 1000);
  expect(convoyReminderMessage(convoy, "day")).toEqual({
    embed: {
      title: "Upcoming convoy: Friday Night Run",
      url: convoy.url,
      description: [
        `Meet-up <t:${meetup}:F>, <t:${meetup}:R>.`,
        `Departure <t:${start}:t>.`,
        `Details and sign-up are on the [TruckersMP event page](${convoy.url}).`,
      ].join("\n"),
      fields: [
        { name: "Route", value: "Hamburg (Garage) to Rotterdam (Port)" },
        { name: "Server", value: "Simulation 1", inline: true },
        { name: "Game", value: "ETS2", inline: true },
      ],
      color: 0x2f63c4,
    },
  });
  expect(convoyReminderMessage(convoy, "hour").embed.title).toBe(
    "Convoy starting soon: Friday Night Run",
  );
});

test("names people typed cannot add formatting, links or mentions", () => {
  expect(plain("**bold** [click](https://evil.example) <@1> @everyone")).toBe(
    "\\*\\*bold\\*\\* \\[click\\]\\(evil.example\\) \\<@1\\> @everyone",
  );
  expect(plain("two\nlines")).toBe("two lines");
  expect(plain("x".repeat(300)).length).toBe(100);
  // @everyone in a name stays text: only the listed user may be pinged.
  const message = rankUpMessage(rankUp({ driverName: "@everyone" }), "Nordic Haulage", "42");
  expect(message.mentionUserIds).toEqual(["42"]);
});

test("no emoji in any message", () => {
  const texts = [
    deliveryMessage(delivery()),
    rankUpMessage(rankUp(), "Nordic Haulage", "42"),
    monthlyMessage("October 2026", [
      { driverId: "a", driverName: "Ingrid", km: 1, atsKm: 0, jobs: 1 },
    ]),
    convoyReminderMessage(convoy, "hour"),
  ].map((m) => JSON.stringify(m));
  for (const text of texts) expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
});
