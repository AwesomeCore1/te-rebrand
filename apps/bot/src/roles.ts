// Rank roles. The bot only ever gives or takes a role that is, right now, the
// `discordRoleId` of a rank of that same company, and never one that carries
// moderation or admin permissions: a rank ladder must not be a way to hand
// someone power over a server. Everything that stops a change comes back as a
// sentence a manager can act on; nothing here throws for a permission problem.
import { DiscordError, type Discord } from "./discord";
import type { CompanyRow, Store } from "./store";

type Change = {
  /** The driver's Discord user id. They are known to be in the server. */
  userId: string;
  driverName: string;
  rankName: string;
  /** The new rank's role, if it has one. */
  give: string | null;
  /** The previous rank's role, if it had one. */
  take: string | null;
};

/**
 * Gives the new rank's role, then takes the previous one. Returns what could
 * not be done and why (empty when all went well).
 *
 * Throws only a DiscordError that passes (Discord unreachable), unless
 * `keepGoing` is set: then that too becomes a line in the result.
 */
export async function changeRankRoles(
  deps: { discord: Discord; store: Store },
  company: CompanyRow,
  guildId: string,
  change: Change,
  { keepGoing = false } = {},
): Promise<string[]> {
  const { discord, store } = deps;
  const give = change.give;
  const take = change.take === give ? null : change.take;
  if (!give && !take) return [];

  const rankRoles = new Set(await store.rankRoleIds(company.id));
  const problems: string[] = [];
  const reason = `Tacho rank: ${change.rankName}`;

  /** Null when the bot may touch the role, else why not. */
  const whyNot = async (roleId: string): Promise<string | null> => {
    if (!rankRoles.has(roleId)) {
      return `Role ${roleId} is not the role of any rank of ${company.name}, so the bot left it alone.`;
    }
    const role = await discord.role(guildId, roleId);
    if (!role) return `Role ${roleId} does not exist in the Discord server.`;
    if (role.managed) {
      return `The role "${role.name}" is managed by Discord or an integration and cannot be given by a bot.`;
    }
    if (role.elevated) {
      return `The role "${role.name}" carries moderation or admin permissions. The bot does not hand those out: use a role without them for the rank.`;
    }
    if (role.aboveBot) {
      return `The bot's own role is below the role "${role.name}". In Server Settings > Roles, drag the bot's role above the rank roles.`;
    }
    return null;
  };

  const attempt = async (roleId: string, action: "addRole" | "removeRole") => {
    try {
      const blocked = await whyNot(roleId);
      if (blocked) {
        problems.push(blocked);
        return false;
      }
      await discord[action](guildId, change.userId, roleId, reason);
      return true;
    } catch (error) {
      if (!(error instanceof DiscordError)) throw error;
      if (error.passes && !keepGoing) throw error;
      problems.push(error.message);
      return false;
    }
  };

  // If the new role cannot be given, the old one stays: better the previous
  // rank's role than none.
  const given = give ? await attempt(give, "addRole") : true;
  if (take && given) await attempt(take, "removeRole");
  return problems;
}
