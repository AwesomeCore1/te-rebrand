// Why the API flagged a job, in plain words with the job's own numbers.
// The checks themselves are `flagReasons` in packages/api/src/tracker.ts; a
// reason added there shows here by its code until it gets a sentence.
import { formatDistance } from "./format";

export type FlaggedNumbers = {
  drivenKm: number;
  plannedKm: number;
  odometerStart: number;
  odometerEnd: number;
  maxSpeedKmh: number;
  startedAt: Date | string;
  finishedAt: Date | string;
};

/** "10 min", "1 h 5 min", "2 h". */
export function formatDuration(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest === 0 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 60)} h ${rest} min`;
}

export function jobDurationMs(job: Pick<FlaggedNumbers, "startedAt" | "finishedAt">) {
  return new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime();
}

export function describeFlag(reason: string, job: FlaggedNumbers, unit: "km" | "mi" = "km") {
  const d = (km: number) => formatDistance(km, unit);
  const speed = (kmh: number) =>
    unit === "mi" ? `${Math.round(kmh / 1.609344)} mph` : `${Math.round(kmh)} km/h`;
  switch (reason) {
    case "avg_speed":
      return `Too far for the time: ${d(job.drivenKm)} in ${formatDuration(jobDurationMs(job))}, with a top speed of ${speed(job.maxSpeedKmh)}.`;
    case "max_speed":
      return `Top speed of ${speed(job.maxSpeedKmh)}, more than a truck in the game can do.`;
    case "odometer_mismatch":
      return `The odometer moved ${d(job.odometerEnd - job.odometerStart)}, but the job reports ${d(job.drivenKm)} driven.`;
    case "far_longer_than_planned":
      return `Drove ${d(job.drivenKm)} on a route planned at ${d(job.plannedKm)}.`;
    case "finish_before_start":
      return "The job ends before it starts, so the PC's clock was changed during it.";
    case "finished_in_future":
      return "The finish time was still in the future when the job arrived, so the PC's clock is wrong.";
    default:
      return `Flagged by a check this page has no words for yet (${reason}).`;
  }
}
