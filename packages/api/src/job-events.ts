// Fines, tolls, ferries and trains during a job. The tracker uploads them with
// the job (`job.events`, packages/telemetry-types) exactly as the game
// reported them; here they become `JobEvent` rows and are read back for the
// job page. Amounts are in the game's currency: EUR in ETS2, USD in ATS.
import type { JobUpload } from "@te-rebrand/telemetry-types";
import { z } from "zod";

const amount = z.number().int();

/** A `JobEvent` row: its `type`, with what its `payload` holds for that type. */
const StoredEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("fine"), offence: z.string(), amount }),
  z.object({ type: z.literal("toll"), amount }),
  z.object({ type: z.literal("ferry"), source: z.string(), target: z.string(), amount }),
  z.object({ type: z.literal("train"), source: z.string(), target: z.string(), amount }),
]);
export type JobEventDetail = z.infer<typeof StoredEventSchema>;

/**
 * When an event happened, as a wall-clock time. The tracker times events on
 * its own clock (`at_ms`, like the job's `started_at_ms`), and sends the
 * job's start and finish on both clocks, so an event sits as far after
 * `started_at` as it sits after `started_at_ms`. A replayed recording is
 * stretched (`Clock::replay` in the tracker), hence the scale; live it is 1.
 */
export function eventTime(upload: JobUpload, atMs: number) {
  const { started_at_ms, finished_at_ms } = upload.job;
  const started = new Date(upload.started_at).getTime();
  const wallSpan = new Date(upload.finished_at).getTime() - started;
  const span = finished_at_ms - started_at_ms;
  // Never outside the job, whatever the tracker sent.
  const elapsed = Math.min(Math.max(atMs - started_at_ms, 0), Math.max(span, 0));
  // A job whose wall-clock times make no sense (it is flagged for that) keeps
  // its events in order at the tracker's own pace.
  const scale = span > 0 && wallSpan > 0 ? wallSpan / span : 1;
  return new Date(Math.round(started + elapsed * scale));
}

/** The `JobEvent` rows for an uploaded job, in the order they happened. */
export function jobEventRows(jobId: string, upload: JobUpload) {
  return upload.job.events.map(({ type, at_ms, ...payload }) => ({
    jobId,
    type,
    at: eventTime(upload, at_ms),
    payload,
  }));
}

/** How to read a job's rows in the order they were stored (ids grow within one insert). */
export const EVENT_ORDER = [{ at: "asc" }, { id: "asc" }] as const;

/** Rows as the job page gets them. A row this code can't read is left out. */
export function readJobEvents(rows: { id: string; type: string; at: Date; payload: unknown }[]) {
  return rows.flatMap((row) => {
    const payload = typeof row.payload === "object" && row.payload ? row.payload : {};
    const event = StoredEventSchema.safeParse({ ...payload, type: row.type });
    return event.success ? [{ id: row.id, at: row.at, ...event.data }] : [];
  });
}
