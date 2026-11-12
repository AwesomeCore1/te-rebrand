// The shape of `Company.settings` (a JSON column). Everything that reads or
// writes it goes through here, so the website, the API and the Discord bot
// agree. Unknown or missing fields fall back to defaults: old rows keep working.
import type { Database } from "@te-rebrand/db";
import { z } from "zod";

/** A Discord snowflake id, or null when not set. */
const channel = z
  .string()
  .regex(/^\d{5,25}$/)
  .nullable()
  .default(null);

export const CompanySettingsSchema = z.object({
  /** Shown on the public company page. Markdown. */
  about: z.string().max(4000).default(""),
  recruitment: z
    .object({
      /** Whether the public page shows the application form. */
      open: z.boolean().default(false),
      /** Questions on the form, in order. Answers are stored by question text. */
      questions: z.array(z.string().trim().min(1).max(200)).max(10).default([]),
    })
    .prefault({}),
  /** Where the bot posts in the company's Discord server (`Company.discordGuildId`). */
  discord: z
    .object({
      deliveryChannelId: channel,
      rankUpChannelId: channel,
      eventChannelId: channel,
      monthlyChannelId: channel,
    })
    .prefault({}),
});
export type CompanySettings = z.infer<typeof CompanySettingsSchema>;

export const DEFAULT_COMPANY_SETTINGS: CompanySettings = CompanySettingsSchema.parse({});

/** Reads the JSON column. Never throws: a row with bad settings gets the defaults. */
export function parseCompanySettings(json: unknown): CompanySettings {
  const parsed = CompanySettingsSchema.safeParse(json ?? {});
  return parsed.success ? parsed.data : DEFAULT_COMPANY_SETTINGS;
}

/**
 * Changes part of a company's settings without losing the rest. Several
 * screens write different parts (recruitment, Discord, about), so always go
 * through this instead of writing the column directly.
 */
export async function updateCompanySettings(
  db: Database,
  companyId: string,
  change: (current: CompanySettings) => CompanySettings,
) {
  return db.$transaction(async (tx) => {
    // Lock the row so two saves at once can't overwrite each other.
    await tx.$queryRaw`SELECT id FROM company WHERE id = ${companyId} FOR UPDATE`;
    const company = await tx.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { settings: true },
    });
    const settings = CompanySettingsSchema.parse(change(parseCompanySettings(company.settings)));
    await tx.company.update({ where: { id: companyId }, data: { settings } });
    return settings;
  });
}
