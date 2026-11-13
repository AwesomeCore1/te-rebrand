// Everything the bot asks of Discord, and nothing more. The rest of the bot
// talks to this interface, so it is tested with a fake (test/fakes.ts). The
// real one is in discord-js.ts.

export type Embed = {
  title?: string;
  /** Makes the title a link. */
  url?: string;
  description?: string;
  fields?: { name: string; value: string; inline?: boolean }[];
  footer?: string;
  /** 0xRRGGBB, the stripe on the left of the embed. */
  color?: number;
};

export type OutgoingMessage = {
  content?: string;
  embed: Embed;
  /** The only users this message may ping. Roles and @everyone are never pinged. */
  mentionUserIds?: string[];
  /**
   * The same key sent twice within a few minutes gives one message: Discord
   * drops the second (its "nonce" check). Covers a retry right after a timeout.
   */
  dedupeKey?: string;
};

/**
 * - bot_not_in_server: the bot was never invited there, or was removed.
 * - missing_permission: Discord or our own check says the bot may not do this.
 * - not_found: the channel, member or role does not exist (any more).
 * - rejected: Discord refused for another reason; trying again will not help.
 * - temporary: Discord answered with an error that passes (5xx, rate limit). Nothing was done.
 * - no_answer: no reply at all (timeout, network). It may or may not have happened.
 */
export type DiscordErrorKind =
  | "bot_not_in_server"
  | "missing_permission"
  | "not_found"
  | "rejected"
  | "temporary"
  | "no_answer";

/** Every failure a `Discord` method reports. The message is written for a VTC manager to read. */
export class DiscordError extends Error {
  constructor(
    readonly kind: DiscordErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "DiscordError";
  }

  /** Worth trying again later without anyone changing anything. */
  get passes() {
    return this.kind === "temporary" || this.kind === "no_answer";
  }
}

export type RoleInfo = {
  name: string;
  /** Owned by an integration or by Discord (boosters); nobody can hand it out. */
  managed: boolean;
  /** Carries moderation or admin permissions. */
  elevated: boolean;
  /** At or above the bot's highest role, so the bot cannot give or take it. */
  aboveBot: boolean;
};

export interface Discord {
  sendMessage(channelId: string, message: OutgoingMessage): Promise<void>;
  /** Giving a role the member already has is fine. `reason` goes to the server's audit log. */
  addRole(guildId: string, userId: string, roleId: string, reason: string): Promise<void>;
  /** Taking a role the member does not have is fine. */
  removeRole(guildId: string, userId: string, roleId: string, reason: string): Promise<void>;
  /** Null when that user is not a member of the server. */
  memberPermissions(guildId: string, userId: string): Promise<{ manageServer: boolean } | null>;
  /** The roles a member has now, without @everyone. Null when that user is not a member of the server. */
  memberRoleIds(guildId: string, userId: string): Promise<string[] | null>;
  /** The server a channel is in. Null when it does not exist or the bot cannot see it. */
  channelGuildId(channelId: string): Promise<string | null>;
  /** Null when the server has no such role. */
  role(guildId: string, roleId: string): Promise<RoleInfo | null>;
}

/** A short text for logs and for the "why" columns in the database. */
export function describeError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error);
}
