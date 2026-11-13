// Rank roles. The bot only ever gives a role that is, right now, the
// `discordRoleId` of a rank of that same company, and never one that carries
// moderation or admin permissions: a rank ladder must not be a way to hand
// someone power over a server. It takes a role only if it is a rank's role in
// that company now, or the API recorded that it stopped being one in the very
// change being handled (see `RoleSync.retired`). Everything that stops a change
// comes back as a sentence a manager can act on; nothing here throws for a
// permission problem.
import { DiscordError, type Discord } from "./discord";
import type { CompanyRow, Store } from "./store";

type Deps = { discord: Discord; store: Store };

/**
 * One member's role changes in one server. `attempt` checks the role first
 * (`allowed` is the set it must be in) and returns whether the change was
 * made; what stopped it is added to `problems`.
 *
 * A DiscordError that passes (Discord unreachable) is thrown, unless
 * `keepGoing` is set: then that too becomes a line in `problems`.
 */
function roleChanger(
  discord: Discord,
  company: CompanyRow,
  guildId: string,
  userId: string,
  keepGoing: boolean,
) {
  const problems: string[] = [];

  /** Null when the bot may touch the role, else why not. */
  const whyNot = async (roleId: string, allowed: ReadonlySet<string>): Promise<string | null> => {
    if (!allowed.has(roleId)) {
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

  const attempt = async (
    roleId: string,
    action: "addRole" | "removeRole",
    allowed: ReadonlySet<string>,
    reason: string,
  ) => {
    try {
      const blocked = await whyNot(roleId, allowed);
      if (blocked) {
        problems.push(blocked);
        return false;
      }
      await discord[action](guildId, userId, roleId, reason);
      return true;
    } catch (error) {
      if (!(error instanceof DiscordError)) throw error;
      if (error.passes && !keepGoing) throw error;
      problems.push(error.message);
      return false;
    }
  };

  return { problems, attempt };
}

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
 * A rank-up: gives the new rank's role, then takes the previous one. Returns
 * what could not be done and why (empty when all went well).
 *
 * Throws only a DiscordError that passes (Discord unreachable), unless
 * `keepGoing` is set: then that too becomes a line in the result.
 */
export async function changeRankRoles(
  deps: Deps,
  company: CompanyRow,
  guildId: string,
  change: Change,
  { keepGoing = false } = {},
): Promise<string[]> {
  const give = change.give;
  const take = change.take === give ? null : change.take;
  if (!give && !take) return [];

  const rankRoles = new Set(await deps.store.rankRoleIds(company.id));
  const { problems, attempt } = roleChanger(
    deps.discord,
    company,
    guildId,
    change.userId,
    keepGoing,
  );
  const reason = `Tacho rank: ${change.rankName}`;

  // If the new role cannot be given, the old one stays: better the previous
  // rank's role than none.
  const given = give ? await attempt(give, "addRole", rankRoles, reason) : true;
  if (take && given) await attempt(take, "removeRole", rankRoles, reason);
  return problems;
}

export type RoleSync = {
  /** The driver's Discord user id. They are known to be in the server. */
  userId: string;
  /** The roles they have in the server now. */
  held: readonly string[];
  /** The role they should hold: their rank's, as an active member. Null: none. */
  want: string | null;
  /**
   * Roles the API recorded as no longer a rank's role, in the change that
   * asked for this sync. They may be taken, never given.
   */
  retired: readonly string[];
  /** For the server's audit log. */
  reason: string;
};

/**
 * Brings one member's rank roles in line: gives `want` if they lack it, then
 * takes every other role they hold that belongs to a rank of the company (or
 * was just retired). A role that is neither is never touched, whatever the
 * member holds. Nothing is asked of Discord for a member who is already right.
 *
 * Returns what was done and what could not be done. Throws only a
 * DiscordError that passes; a sync is safe to run again.
 */
export async function syncRankRoles(
  deps: Deps,
  company: CompanyRow,
  guildId: string,
  sync: RoleSync,
): Promise<{ given: string | null; taken: string[]; problems: string[] }> {
  const rankRoles = new Set(await deps.store.rankRoleIds(company.id));
  const takeable = new Set([...rankRoles, ...sync.retired]);
  const { problems, attempt } = roleChanger(deps.discord, company, guildId, sync.userId, false);

  const { want } = sync;
  const lacks = want !== null && !sync.held.includes(want);
  const given = lacks ? await attempt(want, "addRole", rankRoles, sync.reason) : false;
  // If the role they should have cannot be given, what they hold stays: better
  // the previous rank's role than none.
  const taken: string[] = [];
  if (!lacks || given) {
    for (const roleId of sync.held) {
      if (roleId === want || !takeable.has(roleId)) continue;
      if (await attempt(roleId, "removeRole", takeable, sync.reason)) taken.push(roleId);
    }
  }
  return { given: given ? want : null, taken, problems };
}
