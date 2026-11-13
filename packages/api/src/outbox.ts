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
  /**
   * "Bring this member's rank roles in line." Written when someone joins,
   * leaves, is removed or set inactive, and when a change to the ladder moves
   * them to another role (rank-roles.ts). It posts nothing.
   *
   * The row does not say which role to give: the bot works that out from the
   * database when it gets to the row (an active member gets the role of the
   * rank they hold then, anyone else gets none), and takes every other role
   * that is a rank's role in the company. So a row that waited, or two rows
   * handled out of order, still end in the right roles.
   */
  z.object({
    type: z.literal("rank_roles_sync"),
    driverId: z.string(),
    driverName: z.string(),
    /** What happened. For the log and the row's note; the bot decides nothing by it. */
    reason: z.enum(["joined", "left", "removed", "inactive", "ranks_changed", "server_changed"]),
    /**
     * Roles that stopped being a rank's role in the change that wrote this row
     * (a rank's role was replaced, or the rank deleted). The bot may take
     * these from the member, never give them. Empty for every other reason.
     */
    retiredRoleIds: z.array(z.string()).max(50),
  }),
]);
export type OutboxPayload = z.infer<typeof OutboxPayloadSchema>;
export type RoleSyncReason = Extract<OutboxPayload, { type: "rank_roles_sync" }>["reason"];

export function enqueueOutbox(
  db: Pick<Database, "outboxEvent">,
  companyId: string,
  payload: OutboxPayload,
) {
  return db.outboxEvent.create({ data: { companyId, type: payload.type, payload } });
}
