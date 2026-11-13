import { startMembershipSchedule } from "@te-rebrand/api/membership-check";
import { createAuth } from "@te-rebrand/auth";
import { createPrismaClient } from "@te-rebrand/db";

import { ENV } from "./env.server";

export const db = createPrismaClient(ENV);
export const auth = createAuth(ENV, db);

// The daily TruckersMP membership check runs inside the server (one process).
// In development, run it by hand: bun run membership:check
if (ENV.NODE_ENV === "production") startMembershipSchedule(db);
