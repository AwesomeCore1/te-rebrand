// A job's fines, tolls, ferries and trains in plain words, for the job page.
// They are stored as the game reported them (packages/api/src/job-events.ts);
// the tracker and the API add nothing of their own.
// (The "-" in the file name keeps the router from treating this as a page.)
import { formatIncome } from "@/lib/format";

export type JobEvent =
  | { type: "fine"; offence: string; amount: number }
  | { type: "toll"; amount: number }
  | { type: "ferry"; source: string; target: string; amount: number }
  | { type: "train"; source: string; target: string; amount: number };

/**
 * The game's names for what a fine was for (`fine.offence` in the SCS SDK),
 * in words. `generic` is a fine the game gives no reason for.
 */
const OFFENCES: Record<string, string> = {
  crash: "causing a crash",
  avoid_sleeping: "driving without rest",
  wrong_way: "driving the wrong way",
  speeding_camera: "speeding (camera)",
  no_lights: "driving without lights",
  red_signal: "running a red light",
  speeding: "speeding",
  avoid_weighing: "skipping a weigh station",
  illegal_trailer: "an illegal trailer",
  avoid_inspection: "skipping an inspection",
  illegal_border_crossing: "an illegal border crossing",
  hard_shoulder_violation: "driving on the hard shoulder",
  damaged_vehicle_usage: "driving a damaged vehicle",
  generic: "",
};

/** An offence the list above does not have yet shows as the game named it. */
function offenceWords(offence: string) {
  const key = offence.trim().toLowerCase();
  return OFFENCES[key] ?? key.replace(/_/g, " ");
}

function crossing(kind: string, source: string, target: string) {
  const [from, to] = [source.trim(), target.trim()];
  if (from && to) return `${kind}: ${from} to ${to}`;
  if (to) return `${kind} to ${to}`;
  if (from) return `${kind} from ${from}`;
  return kind;
}

/** "Fine: speeding", "Toll", "Ferry: Dover to Calais". */
export function describeEvent(event: JobEvent) {
  switch (event.type) {
    case "fine": {
      const words = offenceWords(event.offence);
      return words ? `Fine: ${words}` : "Fine";
    }
    case "toll":
      return "Toll";
    case "ferry":
      return crossing("Ferry", event.source, event.target);
    case "train":
      return crossing("Train", event.source, event.target);
  }
}

/** The whole event in one line: "Ferry: Dover to Calais, € 320". */
export function eventLine(event: JobEvent, game: "ets2" | "ats") {
  return `${describeEvent(event)}, ${formatIncome(event.amount, game)}`;
}

/** What the events cost together, in the game's currency. */
export function eventsTotal(events: readonly JobEvent[]) {
  return events.reduce((sum, e) => sum + e.amount, 0);
}

/** "2 fines, 1 toll and 1 ferry", in the order fines, tolls, ferries, trains. */
export function countEvents(events: readonly JobEvent[]) {
  const names = { fine: "fine", toll: "toll", ferry: "ferry", train: "train" } as const;
  const plural = { fine: "fines", toll: "tolls", ferry: "ferries", train: "trains" } as const;
  const parts = (["fine", "toll", "ferry", "train"] as const).flatMap((type) => {
    const n = events.filter((e) => e.type === type).length;
    return n === 0 ? [] : [`${n} ${n === 1 ? names[type] : plural[type]}`];
  });
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}
