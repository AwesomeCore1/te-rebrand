import type { Session } from "@te-rebrand/auth";
import type { Database } from "@te-rebrand/db";

export type Context = {
  session: Session | null;
  db: Database;
};
