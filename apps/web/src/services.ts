import { createAuth } from "@te-rebrand/auth";
import { createPrismaClient } from "@te-rebrand/db";

import { ENV } from "./env.server";

export const db = createPrismaClient(ENV);
export const auth = createAuth(ENV, db);
