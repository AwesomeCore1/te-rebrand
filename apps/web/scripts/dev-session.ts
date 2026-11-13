// Dev only: logs a driver in without Discord, for scripts that need logged-in
// pages (Playwright screenshots, curl). It adds a one-day session row and
// prints the cookie Better Auth expects.
//
//   bun run dev:session                       # the first real (non-seed) user
//   bun run dev:session -- --driver Ingrid    # a driver by display name
//   bun run dev:session -- --clear            # remove the sessions this made
//
// Prints JSON: { name, value, url, driver }. In Playwright:
//   await context.addCookies([{ name, value, url }]);
import "varlock/auto-load";

import { createHmac, randomBytes } from "node:crypto";

import { createPrismaClient } from "@te-rebrand/db";

const env = process.env;
if (env.NODE_ENV === "production") {
  console.error("dev-session is for local development only.");
  process.exit(1);
}

const db = createPrismaClient({ DATABASE_URL: env.DATABASE_URL! });
const args = process.argv.slice(2);
const PREFIX = "dev-session-";

if (args.includes("--clear")) {
  const { count } = await db.session.deleteMany({ where: { id: { startsWith: PREFIX } } });
  console.error(`Removed ${count} dev session${count === 1 ? "" : "s"}.`);
  process.exit(0);
}

const name = args.includes("--driver") ? args[args.indexOf("--driver") + 1] : undefined;
const driver = await db.driver.findFirst({
  where: name ? { displayName: name } : { NOT: { id: { startsWith: "seed-" } } },
  orderBy: { createdAt: "asc" },
});
if (!driver) {
  console.error(name ? `No driver called "${name}".` : "No driver yet. Log in on the site once.");
  process.exit(1);
}

const token = randomBytes(24).toString("base64url");
await db.session.create({
  data: {
    id: PREFIX + randomBytes(8).toString("hex"),
    token,
    userId: driver.userId,
    expiresAt: new Date(Date.now() + 86_400_000),
    updatedAt: new Date(),
    userAgent: "dev-session",
  },
});

// Better Auth signs the cookie as "<token>.<base64 HMAC-SHA256(token, secret)>", URL-encoded.
const signature = createHmac("sha256", env.BETTER_AUTH_SECRET!).update(token).digest("base64");
console.log(
  JSON.stringify({
    name: "better-auth.session_token",
    value: encodeURIComponent(`${token}.${signature}`),
    url: env.BETTER_AUTH_URL,
    driver: driver.displayName,
  }),
);
process.exit(0);
