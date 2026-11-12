// Events for the Discord bot (docs/PLAN.md: delivery feed, rank-ups). The API
// writes a row in the same step as the thing it describes; apps/bot reads
// unprocessed rows and marks them done. Payloads carry what a message needs,
// so the bot does not have to join back into the job tables.
import type { Database } from "@te-rebrand/db";
import { z } from "zod";

export const OutboxPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("job_delivered"),
    jobId: z.string(),
    driverId: z.string(),
    driverName: z.string(),
    game: z.enum(["ets2", "ats"]),
    multiplayer: z.boolean(),
    sourceCity: z.string(),
    destCity: z.string(),
    cargo: z.string(),
    /** km; convert for display only. */
    drivenKm: z.number(),
    /** In the game's currency: EUR for ETS2, USD for ATS. */
    income: z.number(),
  }),
  z.object({
    type: z.literal("rank_up"),
    driverId: z.string(),
    driverName: z.string(),
    rankName: z.string(),
    /** The driver's distance in this company after the job that did it, km. */
    kmInCompany: z.number(),
    /** Discord role to give, and the previous rank's role to take away. */
    discordRoleId: z.string().nullable(),
    previousDiscordRoleId: z.string().nullable(),
  }),
]);
export type OutboxPayload = z.infer<typeof OutboxPayloadSchema>;

export function enqueueOutbox(
  db: Pick<Database, "outboxEvent">,
  companyId: string,
  payload: OutboxPayload,
) {
  return db.outboxEvent.create({ data: { companyId, type: payload.type, payload } });
}
