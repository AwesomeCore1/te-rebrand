// Company settings: name, tag, logo, the About text and where the Discord bot
// posts. Managers may read; only owners change them. The recruitment part of
// the settings has its own screen and is left alone here.
import { z } from "zod";

import { parseCompanySettings, updateCompanySettings } from "../company-settings";
import { companyProcedure, router } from "../index";
import { requestRoleSyncForAll } from "../rank-roles";
import { snowflake } from "./ranks";

const discordId = snowflake.nullable();

const settingsFields = z.object({
  name: z.string().trim().min(2).max(60),
  tag: z.string().trim().min(1).max(8).nullable(),
  logoUrl: z
    .url({ protocol: /^https$/ })
    .max(500)
    .nullable(),
  /** Markdown, shown on the public company page. */
  about: z.string().max(4000),
  /** The company's Discord server. */
  discordGuildId: discordId,
  discord: z.object({
    deliveryChannelId: discordId,
    rankUpChannelId: discordId,
    eventChannelId: discordId,
    monthlyChannelId: discordId,
  }),
});

export const companyProfileRouter = router({
  get: companyProcedure("manager").query(async ({ ctx }) => {
    const company = await ctx.db.company.findUniqueOrThrow({
      where: { id: ctx.companyId },
      select: {
        name: true,
        slug: true,
        tag: true,
        logoUrl: true,
        discordGuildId: true,
        settings: true,
      },
    });
    const { settings, ...profile } = company;
    const { about, discord } = parseCompanySettings(settings);
    return { ...profile, about, discord, canEdit: ctx.membership.role === "owner" };
  }),

  /**
   * What the Discord bot last found, so a manager can see why nothing is
   * posted. The bot writes `BotStatus`; nothing here changes it.
   */
  botStatus: companyProcedure("manager").query(async ({ ctx }) => {
    const [company, status] = await Promise.all([
      ctx.db.company.findUniqueOrThrow({
        where: { id: ctx.companyId },
        select: { discordGuildId: true },
      }),
      ctx.db.botStatus.findUnique({ where: { companyId: ctx.companyId } }),
    ]);
    // A check of a server id the company has since replaced says nothing about this one.
    const checked = status !== null && status.guildId === company.discordGuildId;
    return {
      /** Null: no server is set, so the bot has nowhere to post. */
      guildId: company.discordGuildId,
      /** Null: the bot has not looked at this server yet. */
      server:
        checked && company.discordGuildId
          ? { ok: status.guildOk, reason: status.guildReason, checkedAt: status.checkedAt }
          : null,
      /** The last thing that went wrong, whenever that was. It is not cleared when things work again. */
      lastProblem:
        status?.lastProblem && status.lastProblemAt
          ? { text: status.lastProblem, at: status.lastProblemAt }
          : null,
    };
  }),

  update: companyProcedure("owner")
    .input(settingsFields)
    .mutation(async ({ ctx, input }) => {
      const { name, tag, logoUrl, discordGuildId, about, discord } = input;
      await ctx.db.$transaction(async (tx) => {
        const before = await tx.company.findUniqueOrThrow({
          where: { id: ctx.companyId },
          select: { discordGuildId: true },
        });
        await tx.company.update({
          where: { id: ctx.companyId },
          data: { name, tag, logoUrl, discordGuildId },
        });
        // Another server: nobody has a rank role there yet.
        if (discordGuildId && discordGuildId !== before.discordGuildId) {
          await requestRoleSyncForAll(tx, ctx.companyId, "server_changed");
        }
      });
      // Only about and discord change; recruitment stays as it is.
      await updateCompanySettings(ctx.db, ctx.companyId, (current) => ({
        ...current,
        about,
        discord,
      }));
    }),
});
