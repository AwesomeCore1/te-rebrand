// Runs the TruckersMP membership check by hand (the server runs it by itself
// every day: startMembershipSchedule in packages/api/src/membership-check.ts).
//
//   bun run membership:check              # members not checked in the last 20 hours
//   bun run membership:check -- --all     # everyone, whenever they were last checked
//   bun run membership:check -- --dry-run # say what would change, change nothing
//
// It asks the real TruckersMP API, about 1.5 s apart, so a big platform takes a
// few minutes. Members who left their VTC there become inactive here.
import "varlock/auto-load";

import { checkMemberships, summarise } from "@te-rebrand/api/membership-check";
import { createPrismaClient } from "@te-rebrand/db";

const args = process.argv.slice(2);
const unknown = args.filter((a) => !["--all", "--dry-run"].includes(a));
if (unknown.length > 0) {
  console.error(`Unknown option: ${unknown.join(" ")}. Use --all and/or --dry-run.`);
  process.exit(1);
}
const dryRun = args.includes("--dry-run");

const db = createPrismaClient({ DATABASE_URL: process.env.DATABASE_URL! });
const result = await checkMemberships(db, {
  dryRun,
  ...(args.includes("--all") ? { minAgeMs: 0 } : {}),
});
console.log(summarise(result));
if (dryRun) console.log("Dry run: nothing was changed.");
// Something a person should look at.
process.exit(result.failed.length > 0 || result.rateLimited ? 2 : 0);
