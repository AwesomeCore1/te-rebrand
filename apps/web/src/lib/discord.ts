// Discord ids and the link that adds Tacho's bot to a company's server.

/** Server, channel and role ids are "snowflakes": long numbers. */
export const isDiscordId = (value: string) => /^\d{5,25}$/.test(value);

// What the bot needs: View Channel (1 << 10), Send Messages (1 << 11) and
// Embed Links (1 << 14) to post the feeds, Manage Roles (1 << 28) for rank roles.
export const BOT_PERMISSIONS = (1 << 10) | (1 << 11) | (1 << 14) | (1 << 28);

/** Discord's "add this bot to a server" page; with a server id, that server is preselected. */
export function botInviteUrl(clientId: string, guildId?: string | null) {
  const url = new URL("https://discord.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("scope", "bot");
  url.searchParams.set("permissions", String(BOT_PERMISSIONS));
  if (guildId && isDiscordId(guildId)) url.searchParams.set("guild_id", guildId);
  return url.toString();
}
