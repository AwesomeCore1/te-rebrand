// The nightly membership check (docs/PLAN.md): a driver who left their VTC on
// TruckersMP stops being an active member here. Only companies with a
// TruckersMP VTC id are checked.
//
// Gentle on TruckersMP: one request per company for its member list, one more
// per member who seems to have left (to be sure), and a pause between requests.
// Careful with people: a member is only marked inactive when TruckersMP
// answered twice that they are gone. An outage or a rate limit changes nothing.
import type { Database } from "@te-rebrand/db";
import { TruckersMpError, vtcMembers, vtcMembership } from "@te-rebrand/truckersmp";

const HOUR = 3_600_000;

export type MembershipCheckOptions = {
  fetchImpl?: typeof fetch;
  /** The clock. */
  now?: () => Date;
  /** Waits between requests. */
  sleep?: (ms: number) => Promise<void>;
  /** Pause between two TruckersMP requests. */
  paceMs?: number;
  /**
   * Members checked more recently than this are skipped, so running the check
   * again the same day costs nothing. 0 checks everyone.
   */
  minAgeMs?: number;
  /** Report what would change without changing it. */
  dryRun?: boolean;
};

export type MembershipCheckResult = {
  /** Companies whose members were looked at. */
  companies: number;
  /** Members TruckersMP confirmed are still in the VTC. */
  confirmed: number;
  /** Members who left the VTC on TruckersMP and are now inactive here. */
  deactivated: { company: string; driver: string }[];
  /**
   * Owners who are no longer in their own VTC. They are left alone, because a
   * company without an owner can't be managed; someone has to look at these.
   */
  ownersNotInVtc: { company: string; driver: string }[];
  /** Members with no Steam account linked: nothing to look up. */
  unverifiable: number;
  /** Companies skipped because TruckersMP didn't give a usable answer. */
  failed: { company: string; reason: string }[];
  /** TruckersMP said "too many requests"; the rest waits for the next run. */
  rateLimited: boolean;
  /** Requests made to TruckersMP. */
  requests: number;
};

export async function checkMemberships(
  db: Database,
  {
    fetchImpl = fetch,
    now = () => new Date(),
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    paceMs = 1_500,
    minAgeMs = 20 * HOUR,
    dryRun = false,
  }: MembershipCheckOptions = {},
): Promise<MembershipCheckResult> {
  const result: MembershipCheckResult = {
    companies: 0,
    confirmed: 0,
    deactivated: [],
    ownersNotInVtc: [],
    unverifiable: 0,
    failed: [],
    rateLimited: false,
    requests: 0,
  };

  const inVtcCompany = { status: "active", company: { truckersmpVtcId: { not: null } } } as const;
  // Without a SteamID64 there is nobody to look up. They are counted, not
  // fetched: otherwise they would be "due" on every run, forever.
  result.unverifiable = await db.membership.count({
    where: { ...inVtcCompany, driver: { steamId64: null } },
  });
  const dueBefore = new Date(now().getTime() - minAgeMs);
  const due = await db.membership.findMany({
    where: {
      ...inVtcCompany,
      driver: { steamId64: { not: null } },
      ...(minAgeMs > 0
        ? { OR: [{ lastVtcCheckAt: null }, { lastVtcCheckAt: { lt: dueBefore } }] }
        : {}),
    },
    select: {
      id: true,
      role: true,
      driver: { select: { displayName: true, steamId64: true } },
      company: { select: { id: true, name: true, truckersmpVtcId: true } },
    },
    orderBy: [{ companyId: "asc" }, { joinedAt: "asc" }],
  });

  const byCompany = new Map<string, typeof due>();
  for (const m of due) {
    byCompany.set(m.company.id, [...(byCompany.get(m.company.id) ?? []), m]);
  }

  /** One paced request. Fresh answers only: the cache must not decide this. */
  const ask = async <T>(request: (options: { fetchImpl: typeof fetch; maxAgeMs: 0 }) => T) => {
    if (result.requests > 0) await sleep(paceMs);
    result.requests++;
    return request({ fetchImpl, maxAgeMs: 0 });
  };
  const reasonFor = (e: unknown) => {
    if (!(e instanceof TruckersMpError)) throw e;
    if (e.status === 429) result.rateLimited = true;
    return e.status ? `TruckersMP answered HTTP ${e.status}` : "TruckersMP could not be reached";
  };
  const mark = (ids: string[], data: { status?: "inactive"; leftAt?: Date }) =>
    dryRun || ids.length === 0
      ? undefined
      : db.membership.updateMany({
          // Still active: someone may have left or been removed while we waited.
          where: { id: { in: ids }, status: "active" },
          data: { ...data, lastVtcCheckAt: now() },
        });

  for (const members of byCompany.values()) {
    if (result.rateLimited) break;
    const company = members[0]!.company;
    const vtcId = company.truckersmpVtcId!;

    let list;
    try {
      list = await ask((options) => vtcMembers(vtcId, options));
    } catch (e) {
      result.failed.push({ company: company.name, reason: reasonFor(e) });
      continue;
    }
    if (!list || list.members.length === 0) {
      // A VTC that is gone, or a list with nobody on it. Either would empty the
      // company in one go, so a person decides, not this job.
      result.failed.push({
        company: company.name,
        reason: list ? "TruckersMP returned an empty member list" : "TruckersMP has no such VTC",
      });
      continue;
    }
    result.companies++;
    const inVtc = new Set(list.members.map((m) => m.steamId64));

    const confirmed: string[] = [];
    for (const m of members) {
      const who = { company: company.name, driver: m.driver.displayName };
      const steamId64 = m.driver.steamId64;
      if (!steamId64) continue;
      if (inVtc.has(steamId64)) {
        confirmed.push(m.id);
        continue;
      }
      // Not on the list. Ask about this player before acting on it: the list
      // can be cut short, and a wrong "inactive" costs a driver their company.
      if (result.rateLimited) break;
      let second;
      try {
        second = await ask((options) => vtcMembership(steamId64, vtcId, options));
      } catch (e) {
        reasonFor(e);
        continue; // No answer: leave them as they are until the next run.
      }
      if (second.member) {
        confirmed.push(m.id);
      } else if (m.role === "owner") {
        result.ownersNotInVtc.push(who);
        await mark([m.id], {});
      } else {
        result.deactivated.push(who);
        await mark([m.id], { status: "inactive", leftAt: now() });
      }
    }
    result.confirmed += confirmed.length;
    await mark(confirmed, {});
  }
  return result;
}

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One line for the server log or the terminal. */
export function summarise(r: MembershipCheckResult) {
  const names = (rows: { company: string; driver: string }[]) =>
    rows.map((x) => `${x.driver} (${x.company})`).join(", ");
  return [
    `Membership check: ${count(r.companies, "company", "companies")}, `,
    `${count(r.requests, "TruckersMP request")}. `,
    `${r.confirmed} confirmed, ${r.deactivated.length} left their VTC`,
    r.deactivated.length > 0 ? `: ${names(r.deactivated)}.` : ".",
    r.ownersNotInVtc.length > 0
      ? ` Owners no longer in their own VTC (left alone): ${names(r.ownersNotInVtc)}.`
      : "",
    r.unverifiable > 0 ? ` ${r.unverifiable} without a Steam link.` : "",
    r.failed.length > 0
      ? ` Skipped: ${r.failed.map((f) => `${f.company} (${f.reason})`).join(", ")}.`
      : "",
    r.rateLimited ? " Rate limited; the rest waits for the next run." : "",
  ].join("");
}

const SCHEDULE = Symbol.for("tacho.membership-check.schedule");
type Timers = {
  setInterval: (fn: () => void, ms: number) => { unref?: () => void };
  clearInterval: (handle: never) => void;
};

/**
 * Runs the check inside the web server: an hourly tick, and each tick only
 * looks at members who haven't been checked for 20 hours. So everyone is
 * checked once a day, a restart loses nothing (what is due is in the database,
 * not in memory), and a tick with nothing due makes no requests at all.
 *
 * Safe with one server process: a second start in the same process is ignored,
 * and a tick is skipped while the previous one still runs. With several
 * processes each would run its own; the writes are the same either way, it
 * would only cost extra TruckersMP requests. Move this to one worker if the
 * site is ever scaled out.
 */
export function startMembershipSchedule(
  db: Database,
  {
    intervalMs = HOUR,
    run = (database: Database) => checkMemberships(database),
    log = (line: string) => console.log(line),
    timers = { setInterval, clearInterval } as unknown as Timers,
  } = {},
) {
  const globals = globalThis as { [SCHEDULE]?: () => void };
  if (globals[SCHEDULE]) return globals[SCHEDULE];

  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const result = await run(db);
      if (result.requests > 0) log(summarise(result));
    } catch (e) {
      log(`Membership check failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      running = false;
    }
  };
  const handle = timers.setInterval(() => void tick(), intervalMs);
  // Don't keep the process alive just for this.
  handle.unref?.();
  const stop = () => {
    timers.clearInterval(handle as never);
    delete globals[SCHEDULE];
  };
  globals[SCHEDULE] = stop;
  return stop;
}
