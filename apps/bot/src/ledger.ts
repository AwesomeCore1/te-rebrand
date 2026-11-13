// Scheduled posts (monthly winners, convoy reminders) are sent at most once.
// The BotPost table is the memory: one row per company, kind and key, with a
// unique index, so it holds across restarts and across two bots running by
// mistake.
//
// The order is: claim the row, send, write the outcome.
//   - Discord refused or was down: "failed". Nothing was posted, so it is
//     tried again after a wait, for as long as the post is still due.
//   - The bot stopped between claiming and writing the outcome: the row stays
//     "pending" and is never sent again. It may or may not have gone out.
//   - Discord never answered (timeout): "unknown", and never sent again, for
//     the same reason.
// So the worst case is a post that is missing, never one that appears twice.
import { createHash } from "node:crypto";

import { DiscordError, describeError, type Discord, type OutgoingMessage } from "./discord";
import type { Logger } from "./log";
import type { PostState, Store } from "./store";

export type LedgerDeps = { store: Store; discord: Discord; now: () => Date; log: Logger };

export type Post = {
  companyId: string;
  kind: string;
  key: string;
  /** How long to wait before a failed post is tried again. */
  retryAfterMs: number;
};

/** Whether this post is still ours to send, going by what the table says. */
export function isOpen(state: PostState | undefined, now: Date, retryAfterMs: number) {
  if (!state) return true;
  return state.status === "failed" && now.getTime() - state.updatedAt.getTime() >= retryAfterMs;
}

const claim = (deps: LedgerDeps, post: Post) =>
  deps.store.claimPost(
    post.companyId,
    post.kind,
    post.key,
    new Date(deps.now().getTime() - post.retryAfterMs),
  );

/** At most 25 characters, which is what Discord allows for its duplicate check. */
export function dedupeKey(...parts: string[]) {
  return createHash("sha256").update(parts.join("\n")).digest("hex").slice(0, 25);
}

export async function sendOnce(
  deps: LedgerDeps,
  post: Post,
  channelId: string,
  message: OutgoingMessage,
): Promise<"posted" | "not_ours" | "failed" | "unknown"> {
  if (!(await claim(deps, post))) return "not_ours";
  const { companyId, kind, key } = post;
  try {
    await deps.discord.sendMessage(channelId, {
      ...message,
      dedupeKey: dedupeKey(companyId, kind, key),
    });
  } catch (error) {
    const why = describeError(error);
    const unknown = !(error instanceof DiscordError) || error.kind === "no_answer";
    await deps.store.settlePost(companyId, kind, key, unknown ? "unknown" : "failed", why);
    if (error instanceof DiscordError && !error.passes) {
      await deps.store.recordProblem(companyId, why, deps.now());
    }
    deps.log.warn(`${kind} ${key} for company ${companyId} not posted: ${why}`);
    return unknown ? "unknown" : "failed";
  }
  await deps.store.settlePost(companyId, kind, key, "posted", null);
  return "posted";
}

/** Writes down that a post could not be sent (it is tried again later) or is not needed. */
export async function setAside(
  deps: LedgerDeps,
  post: Post,
  status: "failed" | "skipped",
  detail: string,
) {
  if (!(await claim(deps, post))) return;
  await deps.store.settlePost(post.companyId, post.kind, post.key, status, detail);
}
