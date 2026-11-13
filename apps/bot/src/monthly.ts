// Monthly winners: early on the 1st (UTC), each company's top three drivers of
// the month before, by delivered distance, in its monthly channel.
//
// There is no timer that must fire at midnight. The bot looks every few
// minutes; from 00:15 UTC on the 1st until the end of the 3rd, any company
// that has no BotPost row for that month yet gets its post. So a bot that was
// down on the 1st still posts on the 2nd, and one that restarts never posts a
// month twice (ledger.ts).
import type { Access } from "./access";
import { isOpen, sendOnce, setAside, type LedgerDeps } from "./ledger";
import { monthlyMessage } from "./messages";

export const MONTHLY_KIND = "monthly_winners";
/** Jobs that finish around midnight get a moment to arrive. */
const START_AFTER_MS = 15 * 60_000;
/** Days of the new month in which a missing post is still made. */
const CATCH_UP_DAYS = 3;
const TOP = 3;
/** A post that failed (Discord down, a permission missing) is tried again after this. */
const RETRY_AFTER_MS = 60 * 60_000;

export type Month = {
  /** "2026-10" */
  key: string;
  /** "October 2026" */
  label: string;
  from: Date;
  /** Exclusive: the first moment of the next month. */
  to: Date;
};

/** The month whose results are due at `now`, or null outside the posting days. */
export function monthDue(now: Date): Month | null {
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const sinceStart = now.getTime() - to.getTime();
  if (sinceStart < START_AFTER_MS || now.getUTCDate() > CATCH_UP_DAYS) return null;
  const from = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() - 1, 1));
  return {
    key: `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, "0")}`,
    label: new Intl.DateTimeFormat("en-GB", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    }).format(from),
    from,
    to,
  };
}

export async function postMonthlyWinners(deps: LedgerDeps & { access: Access }) {
  const { store, access, now, log } = deps;
  const month = monthDue(now());
  if (!month) return;

  const companies = (await store.companiesWithDiscord()).filter((c) => c.discord.monthlyChannelId);
  if (companies.length === 0) return;
  const states = new Map(
    (await store.findPosts({ kind: MONTHLY_KIND, keys: [month.key] })).map((s) => [s.companyId, s]),
  );

  for (const company of companies) {
    const post = {
      companyId: company.id,
      kind: MONTHLY_KIND,
      key: month.key,
      retryAfterMs: RETRY_AFTER_MS,
    };
    if (!isOpen(states.get(company.id), now(), RETRY_AFTER_MS)) continue;
    // One company's trouble must not stop the others.
    try {
      const channelId = company.discord.monthlyChannelId!;
      const target = await access.channel(company, channelId);
      if (!target.ok) {
        await setAside(deps, post, "failed", target.reason);
        continue;
      }
      const top = await store.monthlyTop(company.id, month.from, month.to, TOP);
      if (top.length === 0) {
        await setAside(deps, post, "skipped", "No delivered jobs that month.");
        continue;
      }
      const result = await sendOnce(deps, post, channelId, monthlyMessage(month.label, top));
      if (result === "posted") log.info(`monthly winners ${month.key} posted for ${company.name}`);
    } catch (error) {
      log.error(`monthly winners ${month.key} for ${company.name}`, error);
    }
  }
}
