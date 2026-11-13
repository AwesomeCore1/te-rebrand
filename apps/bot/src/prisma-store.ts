// The Store on Postgres. Claims are single UPDATE or INSERT statements with
// the old state in the WHERE clause, so only one caller can win them.
import { parseCompanySettings } from "@te-rebrand/api/company-settings";
import { COUNTS } from "@te-rebrand/api/job-counts";
import type { Database } from "@te-rebrand/db";

import type { CompanyRow, MonthlyDriver, PostState, PostStatus, Store } from "./store";

const COMPANY = {
  id: true,
  name: true,
  discordGuildId: true,
  truckersmpVtcId: true,
  verifiedAt: true,
  settings: true,
} as const;

type RawCompany = {
  id: string;
  name: string;
  discordGuildId: string | null;
  truckersmpVtcId: number | null;
  verifiedAt: Date | null;
  settings: unknown;
};

const toCompany = (c: RawCompany): CompanyRow => ({
  id: c.id,
  name: c.name,
  discordGuildId: c.discordGuildId,
  truckersmpVtcId: c.truckersmpVtcId,
  verified: c.verifiedAt !== null,
  discord: parseCompanySettings(c.settings).discord,
});

/** The "why" columns are for people to read, not for stack traces. */
const clip = (text: string | null) => (text === null ? null : text.slice(0, 1000));

export function prismaStore(db: Database): Store {
  return {
    pendingOutbox(now, limit) {
      return db.outboxEvent.findMany({
        where: {
          processedAt: null,
          OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: limit,
        select: {
          id: true,
          companyId: true,
          type: true,
          payload: true,
          createdAt: true,
          attempts: true,
          lastError: true,
        },
      });
    },

    async claimOutbox(row, until) {
      const { count } = await db.outboxEvent.updateMany({
        where: { id: row.id, processedAt: null, attempts: row.attempts },
        data: { attempts: { increment: 1 }, lastError: null, nextAttemptAt: until },
      });
      return count === 1;
    },

    async claimOutboxForLastTry(row, now, note) {
      const { count } = await db.outboxEvent.updateMany({
        where: { id: row.id, processedAt: null, attempts: row.attempts },
        data: {
          attempts: { increment: 1 },
          processedAt: now,
          lastError: clip(note),
          nextAttemptAt: null,
        },
      });
      return count === 1;
    },

    async finishOutbox(id, now, note) {
      await db.outboxEvent.updateMany({
        where: { id },
        data: { processedAt: now, lastError: clip(note), nextAttemptAt: null },
      });
    },

    async retryOutbox(id, error, nextAttemptAt) {
      await db.outboxEvent.updateMany({
        where: { id, processedAt: null },
        data: { lastError: clip(error), nextAttemptAt },
      });
    },

    async noteOutbox(id, note) {
      await db.outboxEvent.updateMany({ where: { id }, data: { lastError: clip(note) } });
    },

    async company(id) {
      const company = await db.company.findUnique({ where: { id }, select: COMPANY });
      return company ? toCompany(company) : null;
    },

    async companiesWithDiscord() {
      const companies = await db.company.findMany({
        where: { discordGuildId: { not: null } },
        select: COMPANY,
        orderBy: { id: "asc" },
      });
      return companies.map(toCompany);
    },

    async managerDiscordIds(companyId) {
      const members = await db.membership.findMany({
        where: { companyId, status: "active", role: { in: ["owner", "manager"] } },
        select: {
          role: true,
          driver: {
            select: {
              user: {
                select: {
                  accounts: { where: { providerId: "discord" }, select: { accountId: true } },
                },
              },
            },
          },
        },
      });
      const ids = members
        .sort((a, b) => Number(b.role === "owner") - Number(a.role === "owner"))
        .flatMap((m) => m.driver.user.accounts.map((a) => a.accountId));
      return [...new Set(ids)];
    },

    async driverDiscordId(driverId) {
      const account = await db.account.findFirst({
        where: { providerId: "discord", user: { driver: { id: driverId } } },
        select: { accountId: true },
      });
      return account?.accountId ?? null;
    },

    async rankRoleIds(companyId) {
      const ranks = await db.rank.findMany({
        where: { companyId, discordRoleId: { not: null } },
        select: { discordRoleId: true },
      });
      return ranks.flatMap((r) => (r.discordRoleId ? [r.discordRoleId] : []));
    },

    async monthlyTop(companyId, from, to, limit) {
      // Per driver and game, so the message can show miles for ATS drivers.
      const groups = await db.job.groupBy({
        by: ["driverId", "game"],
        where: { companyId, ...COUNTS, finishedAt: { gte: from, lt: to } },
        _sum: { drivenKm: true },
        _count: { _all: true },
      });
      const byDriver = new Map<string, Omit<MonthlyDriver, "driverName">>();
      for (const g of groups) {
        const d = byDriver.get(g.driverId) ?? { driverId: g.driverId, km: 0, atsKm: 0, jobs: 0 };
        const km = g._sum.drivenKm ?? 0;
        d.km += km;
        if (g.game === "ats") d.atsKm += km;
        d.jobs += g._count._all;
        byDriver.set(g.driverId, d);
      }
      const top = [...byDriver.values()]
        .sort((a, b) => b.km - a.km || b.jobs - a.jobs || a.driverId.localeCompare(b.driverId))
        .slice(0, limit);
      const names = new Map(
        (
          await db.driver.findMany({
            where: { id: { in: top.map((d) => d.driverId) } },
            select: { id: true, displayName: true },
          })
        ).map((d) => [d.id, d.displayName]),
      );
      return top.map((d) => ({ ...d, driverName: names.get(d.driverId) ?? "Unknown driver" }));
    },

    async findPosts({ kind, keys, companyId }) {
      const rows = await db.botPost.findMany({
        where: { kind, key: { in: keys }, ...(companyId ? { companyId } : {}) },
        select: { companyId: true, key: true, status: true, updatedAt: true },
      });
      return rows.map((r): PostState => ({ ...r, status: r.status as PostStatus }));
    },

    async claimPost(companyId, kind, key, retryFailedBefore) {
      // The unique index on (companyId, kind, key) lets exactly one insert through.
      const created = await db.botPost.createMany({
        data: [{ companyId, kind, key, status: "pending" }],
        skipDuplicates: true,
      });
      if (created.count === 1) return true;
      const retaken = await db.botPost.updateMany({
        where: { companyId, kind, key, status: "failed", updatedAt: { lte: retryFailedBefore } },
        data: { status: "pending", detail: null },
      });
      return retaken.count === 1;
    },

    async settlePost(companyId, kind, key, status, detail) {
      await db.botPost.updateMany({
        where: { companyId, kind, key },
        data: { status, detail: clip(detail) },
      });
    },

    async prunePosts(kind, before) {
      const { count } = await db.botPost.deleteMany({ where: { kind, createdAt: { lt: before } } });
      return count;
    },

    async saveGuildCheck(companyId, check, now) {
      const data = {
        guildId: check.guildId,
        guildOk: check.ok,
        guildReason: clip(check.reason),
        checkedAt: now,
      };
      await db.botStatus.upsert({
        where: { companyId },
        create: { companyId, ...data },
        update: data,
      });
    },

    async recordProblem(companyId, problem, now) {
      const data = { lastProblem: clip(problem), lastProblemAt: now };
      await db.botStatus.upsert({
        where: { companyId },
        create: { companyId, ...data },
        update: data,
      });
    },
  };
}
