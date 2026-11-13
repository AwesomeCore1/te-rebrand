// A company's rank ladder, for its managers and owners.
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import type { Context } from "../context";
import { companyProcedure, router } from "../index";
import { rankLadder } from "../ranks";

/** A Discord id (role, channel, server): a long number. */
export const snowflake = z
  .string()
  .trim()
  .regex(/^\d{5,25}$/);

const rankFields = z.object({
  name: z.string().trim().min(1).max(40),
  /** Distance in this company from which the rank is held, km. */
  minKm: z.number().min(0).max(100_000_000),
  /** The Discord role the bot gives at this rank, if any. */
  discordRoleId: snowflake.nullable(),
});

/** A ladder has one rank per name and one per distance. */
async function refuseDuplicate(
  db: Context["db"],
  companyId: string,
  rank: z.infer<typeof rankFields>,
  exceptId?: string,
) {
  const clash = await db.rank.findFirst({
    where: {
      companyId,
      ...(exceptId ? { id: { not: exceptId } } : {}),
      OR: [{ name: { equals: rank.name, mode: "insensitive" } }, { minKm: rank.minKm }],
    },
  });
  if (!clash) return;
  throw new TRPCError({
    code: "CONFLICT",
    message:
      clash.name.toLowerCase() === rank.name.toLowerCase()
        ? `There is already a rank called ${clash.name}.`
        : `${clash.name} already starts at ${rank.minKm} km. Pick another distance.`,
  });
}

export const ranksRouter = router({
  /** The ladder, lowest first, with how many active members hold each rank. */
  list: companyProcedure("manager").query(({ ctx }) => rankLadder(ctx.db, ctx.companyId)),

  create: companyProcedure("manager")
    .input(rankFields)
    .mutation(async ({ ctx, input }) => {
      const { companyId: _, ...rank } = input;
      await refuseDuplicate(ctx.db, ctx.companyId, rank);
      return ctx.db.rank.create({ data: { ...rank, companyId: ctx.companyId } });
    }),

  update: companyProcedure("manager")
    .input(rankFields.extend({ rankId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { companyId: _, rankId, ...rank } = input;
      await refuseDuplicate(ctx.db, ctx.companyId, rank, rankId);
      // Scoped by companyId, so a manager can't touch another company's ranks.
      const { count } = await ctx.db.rank.updateMany({
        where: { id: rankId, companyId: ctx.companyId },
        data: rank,
      });
      if (count === 0) throw new TRPCError({ code: "NOT_FOUND", message: "That rank is gone." });
    }),

  delete: companyProcedure("manager")
    .input(z.object({ rankId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const { count } = await ctx.db.rank.deleteMany({
        where: { id: input.rankId, companyId: ctx.companyId },
      });
      if (count === 0) throw new TRPCError({ code: "NOT_FOUND", message: "That rank is gone." });
    }),
});
