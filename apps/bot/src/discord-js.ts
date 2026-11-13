// The real Discord, through discord.js. Kept thin on purpose: this is the one
// file that cannot be tested without a bot token, so the decisions live
// elsewhere and this only asks Discord and turns its errors into DiscordError.
//
// One gateway intent, Guilds (not privileged): it keeps each server's roles
// and channels in memory, which is what permission checks need. Members are
// looked up one at a time over REST, so the Server Members intent is not needed.
import {
  Client,
  DiscordAPIError,
  Events,
  GatewayIntentBits,
  HTTPError,
  PermissionFlagsBits,
  RateLimitError,
  RESTJSONErrorCodes,
  type Guild,
  type GuildMember,
} from "discord.js";

import { DiscordError, type Discord, type Embed, type OutgoingMessage } from "./discord";
import type { Logger } from "./log";

/** A rank role with any of these would make the ladder a way to gain power over a server. */
const ELEVATED =
  PermissionFlagsBits.Administrator |
  PermissionFlagsBits.ManageGuild |
  PermissionFlagsBits.ManageRoles |
  PermissionFlagsBits.ManageChannels |
  PermissionFlagsBits.ManageWebhooks |
  PermissionFlagsBits.ManageMessages |
  PermissionFlagsBits.ManageThreads |
  PermissionFlagsBits.ManageNicknames |
  PermissionFlagsBits.ManageGuildExpressions |
  PermissionFlagsBits.ManageEvents |
  PermissionFlagsBits.KickMembers |
  PermissionFlagsBits.BanMembers |
  PermissionFlagsBits.ModerateMembers |
  PermissionFlagsBits.MuteMembers |
  PermissionFlagsBits.DeafenMembers |
  PermissionFlagsBits.MoveMembers |
  PermissionFlagsBits.ViewAuditLog |
  PermissionFlagsBits.MentionEveryone;

const NOT_FOUND: ReadonlySet<number> = new Set([
  RESTJSONErrorCodes.UnknownChannel,
  RESTJSONErrorCodes.UnknownGuild,
  RESTJSONErrorCodes.UnknownMember,
  RESTJSONErrorCodes.UnknownRole,
  RESTJSONErrorCodes.UnknownUser,
]);
const NO_PERMISSION: ReadonlySet<number> = new Set([
  RESTJSONErrorCodes.MissingAccess,
  RESTJSONErrorCodes.MissingPermissions,
]);

/** `doing` finishes the sentence "Discord ... while <doing>". */
export function toDiscordError(error: unknown, doing: string): DiscordError {
  if (error instanceof DiscordError) return error;
  if (error instanceof DiscordAPIError) {
    const code = typeof error.code === "number" ? error.code : -1;
    if (NO_PERMISSION.has(code)) {
      return new DiscordError(
        "missing_permission",
        `Discord says the bot lacks permission while ${doing}.`,
      );
    }
    if (NOT_FOUND.has(code)) {
      return new DiscordError("not_found", `Discord found nothing while ${doing}.`);
    }
    if (error.status >= 500) {
      return new DiscordError(
        "temporary",
        `Discord had a problem (${error.status}) while ${doing}.`,
      );
    }
    return new DiscordError("rejected", `Discord refused while ${doing}: ${error.message}`);
  }
  if (error instanceof HTTPError) {
    return error.status >= 500
      ? new DiscordError("temporary", `Discord had a problem (${error.status}) while ${doing}.`)
      : new DiscordError("rejected", `Discord refused (${error.status}) while ${doing}.`);
  }
  if (error instanceof RateLimitError) {
    return new DiscordError("temporary", `Discord is rate-limiting the bot while ${doing}.`);
  }
  const detail = error instanceof Error ? error.message : String(error);
  return new DiscordError("no_answer", `No answer from Discord while ${doing}: ${detail}`);
}

const cut = (text: string | undefined, max: number) =>
  text !== undefined && text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Our embed as Discord's JSON, held to Discord's length limits. */
export function toApiEmbed(embed: Embed) {
  return {
    title: cut(embed.title, 256),
    url: embed.url,
    description: cut(embed.description, 4096),
    fields: embed.fields?.slice(0, 25).map((f) => ({
      name: cut(f.name, 256)!,
      value: cut(f.value, 1024)!,
      inline: f.inline,
    })),
    footer: embed.footer ? { text: cut(embed.footer, 2048)! } : undefined,
    color: embed.color,
  };
}

export class DiscordJs implements Discord {
  constructor(private readonly client: Client<true>) {}

  private guild(guildId: string): Guild {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) {
      throw new DiscordError("bot_not_in_server", `The bot is not in the server ${guildId}.`);
    }
    if (!guild.available) {
      throw new DiscordError("temporary", `Discord reports the server ${guildId} as unavailable.`);
    }
    return guild;
  }

  private async me(guild: Guild): Promise<GuildMember> {
    return guild.members.me ?? (await guild.members.fetchMe());
  }

  private async fetchChannel(channelId: string) {
    const cached = this.client.channels.cache.get(channelId);
    if (cached) return cached;
    try {
      return await this.client.channels.fetch(channelId);
    } catch (error) {
      const mapped = toDiscordError(error, `looking up channel ${channelId}`);
      // Not there, or in a server the bot is not in: both mean "cannot see it".
      if (mapped.kind === "not_found" || mapped.kind === "missing_permission") return null;
      if (mapped.kind === "rejected") return null; // not a valid id
      throw mapped;
    }
  }

  async channelGuildId(channelId: string) {
    const channel = await this.fetchChannel(channelId);
    return channel && !channel.isDMBased() ? channel.guildId : null;
  }

  async sendMessage(channelId: string, message: OutgoingMessage) {
    const channel = await this.fetchChannel(channelId);
    if (!channel || channel.isDMBased() || !channel.isSendable()) {
      throw new DiscordError(
        "not_found",
        `Channel ${channelId} does not exist, is not a text channel, or the bot cannot see it.`,
      );
    }
    try {
      const me = await this.me(channel.guild);
      const needed = [
        PermissionFlagsBits.ViewChannel,
        channel.isThread()
          ? PermissionFlagsBits.SendMessagesInThreads
          : PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.EmbedLinks,
      ];
      const missing = channel.permissionsFor(me).missing(needed);
      if (missing.length > 0) {
        throw new DiscordError(
          "missing_permission",
          `The bot lacks ${missing.join(", ")} in the channel #${channel.name}.`,
        );
      }
      await channel.send({
        content: message.content,
        embeds: [toApiEmbed(message.embed)],
        allowedMentions: { parse: [], users: message.mentionUserIds ?? [] },
        ...(message.dedupeKey ? { nonce: message.dedupeKey, enforceNonce: true } : {}),
      });
    } catch (error) {
      throw toDiscordError(error, `posting in #${channel.name}`);
    }
  }

  async memberPermissions(guildId: string, userId: string) {
    const guild = this.guild(guildId);
    try {
      // force: without the Server Members intent a cached member goes stale.
      const member = await guild.members.fetch({ user: userId, force: true });
      return { manageServer: member.permissions.has(PermissionFlagsBits.ManageGuild) };
    } catch (error) {
      const mapped = toDiscordError(error, `looking up a member of ${guild.name}`);
      if (mapped.kind === "not_found") return null;
      throw mapped;
    }
  }

  async memberRoleIds(guildId: string, userId: string) {
    const guild = this.guild(guildId);
    try {
      // force: without the Server Members intent a cached member goes stale.
      const member = await guild.members.fetch({ user: userId, force: true });
      // @everyone has the server's own id and is not a role anyone holds by choice.
      return [...member.roles.cache.keys()].filter((id) => id !== guild.id);
    } catch (error) {
      const mapped = toDiscordError(error, `looking up a member of ${guild.name}`);
      if (mapped.kind === "not_found") return null;
      throw mapped;
    }
  }

  async role(guildId: string, roleId: string) {
    const guild = this.guild(guildId);
    try {
      const role = guild.roles.cache.get(roleId) ?? (await guild.roles.fetch(roleId));
      // @everyone has the server's own id and is not a role anyone can be given.
      if (!role || role.id === guild.id) return null;
      const me = await this.me(guild);
      return {
        name: role.name,
        managed: role.managed,
        elevated: role.permissions.any(ELEVATED),
        aboveBot: me.roles.highest.comparePositionTo(role) <= 0,
      };
    } catch (error) {
      const mapped = toDiscordError(error, `looking up a role in ${guild.name}`);
      if (mapped.kind === "not_found" || mapped.kind === "rejected") return null;
      throw mapped;
    }
  }

  private async changeRole(
    action: "addRole" | "removeRole",
    guildId: string,
    userId: string,
    roleId: string,
    reason: string,
  ) {
    const guild = this.guild(guildId);
    try {
      const me = await this.me(guild);
      if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
        throw new DiscordError(
          "missing_permission",
          `The bot lacks the Manage Roles permission in ${guild.name}.`,
        );
      }
      await guild.members[action]({ user: userId, role: roleId, reason });
    } catch (error) {
      throw toDiscordError(error, `changing a member's roles in ${guild.name}`);
    }
  }

  addRole(guildId: string, userId: string, roleId: string, reason: string) {
    return this.changeRole("addRole", guildId, userId, roleId, reason);
  }

  removeRole(guildId: string, userId: string, roleId: string, reason: string) {
    return this.changeRole("removeRole", guildId, userId, roleId, reason);
  }
}

export class TokenRejected extends Error {}

/**
 * Logs in and waits until the bot knows its servers. Throws TokenRejected when
 * Discord does not accept the token.
 */
export async function connectDiscord(token: string, log: Logger) {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
    // Nothing pings unless a message says exactly who (see sendMessage).
    allowedMentions: { parse: [] },
  });
  client.on(Events.Error, (error) => log.error("Discord connection", error));
  client.on(Events.GuildCreate, (guild) => log.info(`joined the server "${guild.name}"`));
  client.on(Events.GuildDelete, (guild) => log.info(`left the server "${guild.name}"`));

  const ready = new Promise<Client<true>>((resolve) => client.once(Events.ClientReady, resolve));
  try {
    await client.login(token);
  } catch (error) {
    await client.destroy();
    const code = (error as { code?: unknown }).code;
    if (code === "TokenInvalid" || (error instanceof DiscordAPIError && error.status === 401)) {
      throw new TokenRejected("Discord did not accept DISCORD_BOT_TOKEN.");
    }
    throw error;
  }
  const readyClient = await ready;
  return {
    discord: new DiscordJs(readyClient) as Discord,
    name: readyClient.user.tag,
    servers: () => readyClient.guilds.cache.size,
    close: () => client.destroy(),
  };
}
