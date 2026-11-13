// A Discord and a database that live in memory, for the tests.
import { DEFAULT_COMPANY_SETTINGS } from "@te-rebrand/api/company-settings";
import type { OutboxPayload } from "@te-rebrand/api/outbox";

import { createBot } from "../src/bot";
import { DiscordError, type Discord, type OutgoingMessage, type RoleInfo } from "../src/discord";
import { silentLogger } from "../src/log";
import type {
  CompanyRow,
  MonthlyDriver,
  OutboxRow,
  PostState,
  PostStatus,
  Store,
} from "../src/store";

type FakeGuild = {
  channels: Set<string>;
  /** userId -> their permission and roles */
  members: Map<string, { manageServer: boolean; roles: Set<string> }>;
  roles: Map<string, RoleInfo>;
  botCanManageRoles: boolean;
};

export class FakeDiscord implements Discord {
  guilds = new Map<string, FakeGuild>();
  sent: { channelId: string; message: OutgoingMessage }[] = [];
  roleChanges: { action: "add" | "remove"; guildId: string; userId: string; roleId: string }[] = [];
  memberLookups = 0;
  channelLookups = 0;
  /** Errors for the next calls to sendMessage, in order. `afterSending` posts first, then throws. */
  sendFailures: { error: Error; afterSending?: boolean }[] = [];
  /** Errors for the next role changes. */
  roleFailures: Error[] = [];
  /** Errors for the next member lookups. */
  lookupFailures: Error[] = [];

  addGuild(id: string, guild: Partial<FakeGuild> = {}) {
    const full: FakeGuild = {
      channels: new Set(),
      members: new Map(),
      roles: new Map(),
      botCanManageRoles: true,
      ...guild,
    };
    this.guilds.set(id, full);
    return full;
  }

  private guild(guildId: string) {
    const guild = this.guilds.get(guildId);
    if (!guild) {
      throw new DiscordError("bot_not_in_server", `The bot is not in the server ${guildId}.`);
    }
    return guild;
  }

  async sendMessage(channelId: string, message: OutgoingMessage) {
    const failure = this.sendFailures.shift();
    if (failure && !failure.afterSending) throw failure.error;
    if ((await this.channelGuildId(channelId)) === null) {
      throw new DiscordError("not_found", `Channel ${channelId} does not exist.`);
    }
    this.sent.push({ channelId, message });
    if (failure) throw failure.error;
  }

  private async changeRole(
    action: "add" | "remove",
    guildId: string,
    userId: string,
    roleId: string,
  ) {
    const failure = this.roleFailures.shift();
    if (failure) throw failure;
    const guild = this.guild(guildId);
    if (!guild.botCanManageRoles) {
      throw new DiscordError("missing_permission", "The bot lacks the Manage Roles permission.");
    }
    const member = guild.members.get(userId);
    if (!member) throw new DiscordError("not_found", "That member is not in the server.");
    if (action === "add") member.roles.add(roleId);
    else member.roles.delete(roleId);
    this.roleChanges.push({ action, guildId, userId, roleId });
  }

  addRole(guildId: string, userId: string, roleId: string) {
    return this.changeRole("add", guildId, userId, roleId);
  }

  removeRole(guildId: string, userId: string, roleId: string) {
    return this.changeRole("remove", guildId, userId, roleId);
  }

  async memberPermissions(guildId: string, userId: string) {
    this.memberLookups++;
    const failure = this.lookupFailures.shift();
    if (failure) throw failure;
    const member = this.guild(guildId).members.get(userId);
    return member ? { manageServer: member.manageServer } : null;
  }

  async channelGuildId(channelId: string) {
    this.channelLookups++;
    for (const [id, guild] of this.guilds) if (guild.channels.has(channelId)) return id;
    return null;
  }

  async role(guildId: string, roleId: string) {
    return this.guild(guildId).roles.get(roleId) ?? null;
  }
}

type StoredOutbox = OutboxRow & { processedAt: Date | null; nextAttemptAt: Date | null };
type StoredPost = PostState & { kind: string; detail: string | null; createdAt: Date };
type Job = {
  companyId: string;
  driverId: string;
  game: "ets2" | "ats";
  km: number;
  finishedAt: Date;
  status?: "delivered" | "cancelled" | "flagged" | "rejected";
};

export class MemoryStore implements Store {
  companies = new Map<string, CompanyRow>();
  managers = new Map<string, string[]>();
  drivers = new Map<string, { name: string; discordId: string | null }>();
  rankRoles = new Map<string, string[]>();
  jobs: Job[] = [];
  outbox: StoredOutbox[] = [];
  posts: StoredPost[] = [];
  guildChecks = new Map<string, { guildId: string; ok: boolean; reason: string | null }>();
  problems: { companyId: string; problem: string }[] = [];
  /** The clock for `updatedAt`; tests point it at their own. */
  now: () => Date = () => new Date();
  /** Throw from the next call to this method, once: a stand-in for the bot dying there. */
  failNext: Partial<Record<keyof Store, Error>> = {};
  private nextId = 1;

  private maybeFail(method: keyof Store) {
    const error = this.failNext[method];
    if (error) {
      delete this.failNext[method];
      throw error;
    }
  }

  addCompany(company: Partial<CompanyRow> & { id: string }) {
    const row: CompanyRow = {
      name: "Nordic Haulage",
      discordGuildId: null,
      truckersmpVtcId: null,
      verified: false,
      ...company,
      discord: { ...DEFAULT_COMPANY_SETTINGS.discord, ...company.discord },
    };
    this.companies.set(row.id, row);
    return row;
  }

  enqueue(companyId: string, payload: OutboxPayload | Record<string, unknown>, createdAt: Date) {
    const row: StoredOutbox = {
      id: `evt-${this.nextId++}`,
      companyId,
      type: String(payload.type),
      payload,
      createdAt,
      attempts: 0,
      lastError: null,
      processedAt: null,
      nextAttemptAt: null,
    };
    this.outbox.push(row);
    return row;
  }

  private row(id: string) {
    return this.outbox.find((r) => r.id === id)!;
  }

  async pendingOutbox(now: Date, limit: number) {
    return this.outbox
      .filter((r) => !r.processedAt && (!r.nextAttemptAt || r.nextAttemptAt <= now))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }

  async claimOutbox(row: Pick<OutboxRow, "id" | "attempts">, until: Date) {
    const stored = this.row(row.id);
    if (stored.processedAt || stored.attempts !== row.attempts) return false;
    Object.assign(stored, { attempts: stored.attempts + 1, lastError: null, nextAttemptAt: until });
    return true;
  }

  async claimOutboxForLastTry(row: Pick<OutboxRow, "id" | "attempts">, now: Date, note: string) {
    const stored = this.row(row.id);
    if (stored.processedAt || stored.attempts !== row.attempts) return false;
    Object.assign(stored, {
      attempts: stored.attempts + 1,
      processedAt: now,
      lastError: note,
      nextAttemptAt: null,
    });
    return true;
  }

  async finishOutbox(id: string, now: Date, note: string | null) {
    this.maybeFail("finishOutbox");
    Object.assign(this.row(id), { processedAt: now, lastError: note, nextAttemptAt: null });
  }

  async retryOutbox(id: string, error: string, nextAttemptAt: Date) {
    Object.assign(this.row(id), { lastError: error, nextAttemptAt });
  }

  async noteOutbox(id: string, note: string) {
    this.row(id).lastError = note;
  }

  async company(id: string) {
    return this.companies.get(id) ?? null;
  }

  async companiesWithDiscord() {
    // By id, like the real store.
    return [...this.companies.values()]
      .filter((c) => c.discordGuildId)
      .sort((x, y) => x.id.localeCompare(y.id));
  }

  async managerDiscordIds(companyId: string) {
    return this.managers.get(companyId) ?? [];
  }

  async driverDiscordId(driverId: string) {
    return this.drivers.get(driverId)?.discordId ?? null;
  }

  async rankRoleIds(companyId: string) {
    return this.rankRoles.get(companyId) ?? [];
  }

  async monthlyTop(companyId: string, from: Date, to: Date, limit: number) {
    const byDriver = new Map<string, MonthlyDriver>();
    for (const job of this.jobs) {
      if (job.companyId !== companyId || (job.status ?? "delivered") !== "delivered") continue;
      if (job.finishedAt < from || job.finishedAt >= to) continue;
      const d = byDriver.get(job.driverId) ?? {
        driverId: job.driverId,
        driverName: this.drivers.get(job.driverId)?.name ?? job.driverId,
        km: 0,
        atsKm: 0,
        jobs: 0,
      };
      d.km += job.km;
      if (job.game === "ats") d.atsKm += job.km;
      d.jobs++;
      byDriver.set(job.driverId, d);
    }
    return [...byDriver.values()].sort((a, b) => b.km - a.km).slice(0, limit);
  }

  async findPosts({ kind, keys, companyId }: { kind: string; keys: string[]; companyId?: string }) {
    return this.posts
      .filter(
        (p) => p.kind === kind && keys.includes(p.key) && (!companyId || p.companyId === companyId),
      )
      .map((p) => ({ ...p }));
  }

  private post(companyId: string, kind: string, key: string) {
    return this.posts.find((p) => p.companyId === companyId && p.kind === kind && p.key === key);
  }

  async claimPost(companyId: string, kind: string, key: string, retryFailedBefore: Date) {
    const existing = this.post(companyId, kind, key);
    const now = this.now();
    if (!existing) {
      this.posts.push({
        companyId,
        kind,
        key,
        status: "pending",
        detail: null,
        createdAt: now,
        updatedAt: now,
      });
      return true;
    }
    if (existing.status !== "failed" || existing.updatedAt > retryFailedBefore) return false;
    Object.assign(existing, { status: "pending", detail: null, updatedAt: now });
    return true;
  }

  async settlePost(
    companyId: string,
    kind: string,
    key: string,
    status: Exclude<PostStatus, "pending">,
    detail: string | null,
  ) {
    this.maybeFail("settlePost");
    Object.assign(this.post(companyId, kind, key)!, { status, detail, updatedAt: this.now() });
  }

  async prunePosts(kind: string, before: Date) {
    const kept = this.posts.filter((p) => p.kind !== kind || p.createdAt >= before);
    const removed = this.posts.length - kept.length;
    this.posts = kept;
    return removed;
  }

  async saveGuildCheck(
    companyId: string,
    check: { guildId: string; ok: boolean; reason: string | null },
  ) {
    this.guildChecks.set(companyId, check);
  }

  async recordProblem(companyId: string, problem: string) {
    this.problems.push({ companyId, problem });
  }
}

export const GUILD = "100000000000000001";
export const OTHER_GUILD = "100000000000000002";
export const CHANNEL = {
  delivery: "200000000000000001",
  rankUp: "200000000000000002",
  events: "200000000000000003",
  monthly: "200000000000000004",
  /** A channel in OTHER_GUILD. */
  elsewhere: "200000000000000099",
};
export const OWNER = "300000000000000001";
export const DRIVER = "300000000000000002";
export const ROLE = { rookie: "400000000000000001", veteran: "400000000000000002" };
const plainRole = (name: string): RoleInfo => ({
  name,
  managed: false,
  elevated: false,
  aboveBot: false,
});

/**
 * One company ("nh") set up the way a real one would be: its owner runs the
 * server, every channel is set, two rank roles, one driver in the server. And
 * a second server the bot is in that belongs to somebody else.
 */
export function world(start = "2026-11-13T12:00:00Z") {
  let current = new Date(start);
  const clock = {
    now: () => new Date(current),
    set: (iso: string) => void (current = new Date(iso)),
    advance: (ms: number) => void (current = new Date(current.getTime() + ms)),
  };
  const discord = new FakeDiscord();
  discord.addGuild(GUILD, {
    channels: new Set([CHANNEL.delivery, CHANNEL.rankUp, CHANNEL.events, CHANNEL.monthly]),
    members: new Map([
      [OWNER, { manageServer: true, roles: new Set<string>() }],
      [DRIVER, { manageServer: false, roles: new Set([ROLE.rookie]) }],
    ]),
    roles: new Map([
      [ROLE.rookie, plainRole("Rookie")],
      [ROLE.veteran, plainRole("Veteran")],
    ]),
  });
  discord.addGuild(OTHER_GUILD, {
    channels: new Set([CHANNEL.elsewhere]),
    members: new Map([["399999999999999999", { manageServer: true, roles: new Set<string>() }]]),
    roles: new Map([["499999999999999999", plainRole("Their role")]]),
  });

  const store = new MemoryStore();
  store.now = clock.now;
  const company = store.addCompany({
    id: "nh",
    discordGuildId: GUILD,
    truckersmpVtcId: 7,
    verified: true,
    discord: {
      deliveryChannelId: CHANNEL.delivery,
      rankUpChannelId: CHANNEL.rankUp,
      eventChannelId: CHANNEL.events,
      monthlyChannelId: CHANNEL.monthly,
    },
  });
  store.managers.set("nh", [OWNER]);
  store.drivers.set("ingrid", { name: "Ingrid", discordId: DRIVER });
  store.rankRoles.set("nh", [ROLE.rookie, ROLE.veteran]);

  /** A bot as it is after a restart: same database, same Discord, empty memory. */
  const startBot = (extra: Partial<Parameters<typeof createBot>[0]> = {}) =>
    createBot({ store, discord, log: silentLogger, now: clock.now, ...extra });

  return { clock, discord, store, company, startBot, bot: startBot() };
}

export const delivery = (over: Partial<Extract<OutboxPayload, { type: "job_delivered" }>> = {}) =>
  ({
    type: "job_delivered",
    jobId: "job-1",
    driverId: "ingrid",
    driverName: "Ingrid",
    game: "ets2",
    multiplayer: true,
    sourceCity: "Hamburg",
    destCity: "Lyon",
    cargo: "Electronics",
    drivenKm: 1196,
    income: 24310,
    ...over,
  }) satisfies OutboxPayload;

export const rankUp = (over: Partial<Extract<OutboxPayload, { type: "rank_up" }>> = {}) =>
  ({
    type: "rank_up",
    driverId: "ingrid",
    driverName: "Ingrid",
    rankName: "Veteran",
    kmInCompany: 25012,
    discordRoleId: ROLE.veteran,
    previousDiscordRoleId: ROLE.rookie,
    ...over,
  }) satisfies OutboxPayload;
