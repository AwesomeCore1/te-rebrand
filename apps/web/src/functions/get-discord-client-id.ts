import { createServerFn } from "@tanstack/react-start";

import { ENV } from "@/env.server";

/**
 * The Discord application's id, for the "Add the bot to your server" link.
 * It is public (part of every Discord login link), unlike the client secret.
 */
export const getDiscordClientId = createServerFn({ method: "GET" }).handler(
  () => ENV.DISCORD_CLIENT_ID,
);
