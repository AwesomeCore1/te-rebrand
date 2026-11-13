// The Tacho Discord bot. One process, one bot, every VTC's server.
//
//   bun run dev:bot        (from the repo root)
//
// Without DISCORD_BOT_TOKEN it starts, says so and waits: nothing is read from
// the database and nothing is posted. It stays up instead of exiting so that
// `bun run dev` and `docker compose up` do not fail or restart in a loop on a
// machine that has no token. See README.md.
import "varlock/auto-load";

import { createPrismaClient } from "@te-rebrand/db";

import { startBot } from "./bot";
import { connectDiscord, TokenRejected } from "./discord-js";
import { consoleLogger as log } from "./log";
import { prismaStore } from "./prisma-store";

let shutDown: () => Promise<void> = async () => {};
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (stopping) return;
    stopping = true;
    log.info("stopping");
    void shutDown().finally(() => process.exit(0));
  });
}

/** Keeps the process alive, doing nothing, until it is told to stop. */
function idle(why: string) {
  log.warn(`${why} The bot is idle: nothing will be posted. Fix it and start the bot again.`);
  const keepAlive = setInterval(() => {}, 60 * 60_000);
  shutDown = async () => clearInterval(keepAlive);
}

async function main() {
  const token = process.env.DISCORD_BOT_TOKEN?.trim();
  if (!token) {
    idle("DISCORD_BOT_TOKEN is not set (put it in apps/bot/.env, see apps/bot/README.md).");
    return;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    idle("DATABASE_URL is not set (it comes from apps/web/.env).");
    return;
  }

  let connection: Awaited<ReturnType<typeof connectDiscord>>;
  try {
    connection = await connectDiscord(token, log);
  } catch (error) {
    if (error instanceof TokenRejected) {
      idle(`${error.message} Reset the token in the Discord developer portal and set the new one.`);
      return;
    }
    throw error;
  }

  const db = createPrismaClient({ DATABASE_URL: databaseUrl });
  const bot = startBot({ store: prismaStore(db), discord: connection.discord, log });
  shutDown = async () => {
    await bot.stop();
    await connection.close();
    await db.$disconnect();
  };
  log.info(
    `connected to Discord as ${connection.name}, in ${connection.servers()} server(s). ` +
      "Watching for deliveries, rank-ups, monthly winners and convoys.",
  );
}

main().catch((error) => {
  log.error("the bot could not start", error);
  process.exit(1);
});
