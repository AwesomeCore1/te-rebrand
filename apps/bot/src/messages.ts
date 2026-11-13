// What the bot says. Dispatcher voice: short, factual, plain (PRODUCT.md).
// No emoji, no logos, and nobody is pinged except a driver on their own rank-up.
import type { OutboxPayload } from "@te-rebrand/api/outbox";
import type { TmpEvent } from "@te-rebrand/truckersmp";

import type { OutgoingMessage } from "./discord";
import { count, distance, gameName, km, money, plain, type Game } from "./format";
import type { MonthlyDriver } from "./store";

// DESIGN.md tokens: the game badges and the amber primary.
const COLOR = { ets2: 0x2f63c4, ats: 0x137a6d, amber: 0xf5a524 } as const;

type Delivery = Extract<OutboxPayload, { type: "job_delivered" }>;
type RankUp = Extract<OutboxPayload, { type: "rank_up" }>;

export function deliveryMessage(job: Delivery): OutgoingMessage {
  const where = job.multiplayer ? "TruckersMP" : "singleplayer";
  return {
    embed: {
      description: `**${plain(job.driverName)}** delivered ${plain(job.cargo)} from ${plain(job.sourceCity)} to ${plain(job.destCity)}.`,
      fields: [
        { name: "Distance", value: distance(job.drivenKm, job.game), inline: true },
        { name: "Income", value: money(job.income, job.game), inline: true },
        { name: "Game", value: `${gameName(job.game)}, ${where}`, inline: true },
      ],
      color: COLOR[job.game],
    },
  };
}

/** `mentionUserId`: the driver's Discord id, when they are in the server. */
export function rankUpMessage(
  rankUp: RankUp,
  companyName: string,
  mentionUserId: string | null,
): OutgoingMessage {
  return {
    ...(mentionUserId ? { content: `<@${mentionUserId}>`, mentionUserIds: [mentionUserId] } : {}),
    embed: {
      description: `**${plain(rankUp.driverName)}** reached the rank **${plain(rankUp.rankName)}**.`,
      fields: [{ name: `Distance for ${plain(companyName)}`, value: km(rankUp.kmInCompany) }],
      color: COLOR.amber,
    },
  };
}

/** Miles alongside for a driver who mostly drove ATS that month. */
function monthlyDistance(driver: MonthlyDriver): string {
  return distance(driver.km, driver.atsKm > driver.km / 2 ? "ats" : "ets2");
}

/** `monthLabel` like "October 2026". `drivers` is the top of the list, furthest first. */
export function monthlyMessage(monthLabel: string, drivers: MonthlyDriver[]): OutgoingMessage {
  return {
    embed: {
      title: `${monthLabel}: top drivers`,
      description: drivers
        .map(
          (d, i) =>
            `${i + 1}. **${plain(d.driverName)}**: ${monthlyDistance(d)} in ${count(d.jobs, "job")}`,
        )
        .join("\n"),
      footer: "Delivered jobs only. Months run on UTC time.",
      color: COLOR.amber,
    },
  };
}

function place(p: TmpEvent["from"]) {
  if (p.city && p.location) return `${plain(p.city)} (${plain(p.location)})`;
  return p.city || p.location ? plain((p.city ?? p.location)!) : null;
}

const unix = (date: Date) => Math.floor(date.getTime() / 1000);

export type ReminderWhen = "day" | "hour";

/**
 * Times are Discord timestamps (`<t:...>`): every reader sees them in their own
 * time zone, and the "in 3 hours" part keeps counting down.
 */
export function convoyReminderMessage(event: TmpEvent, when: ReminderWhen): OutgoingMessage {
  const name = plain(event.name, 200);
  const from = place(event.from);
  const to = place(event.to);
  const route = from && to ? `${from} to ${to}` : (from ?? to);
  const meetup = unix(event.meetupAt);
  const lines = [`Meet-up <t:${meetup}:F>, <t:${meetup}:R>.`];
  if (event.startAt.getTime() !== event.meetupAt.getTime()) {
    lines.push(`Departure <t:${unix(event.startAt)}:t>.`);
  }
  lines.push(`Details and sign-up are on the [TruckersMP event page](${event.url}).`);
  return {
    embed: {
      title: when === "hour" ? `Convoy starting soon: ${name}` : `Upcoming convoy: ${name}`,
      url: event.url,
      description: lines.join("\n"),
      fields: [
        ...(route ? [{ name: "Route", value: route }] : []),
        ...(event.server ? [{ name: "Server", value: plain(event.server), inline: true }] : []),
        { name: "Game", value: gameName(event.game as Game), inline: true },
      ],
      color: COLOR[event.game],
    },
  };
}
