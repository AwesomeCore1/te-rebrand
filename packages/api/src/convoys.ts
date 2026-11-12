// Convoys shown on Tacho: only events of VTCs that use Tacho. They're run on
// TruckersMP; we read them from there and store nothing (docs/PLAN.md).
import type { Database } from "@te-rebrand/db";
import { hostedEvents, type TmpEvent } from "@te-rebrand/truckersmp";

type TachoCompany = { name: string; slug: string; tag: string | null; truckersmpVtcId: number };
export type Convoy = TmpEvent & {
  hostedByVtc: boolean;
  /** The Tacho company hosting it, when the host uses Tacho. */
  company: { name: string; slug: string; tag: string | null } | null;
};

/** Companies whose TruckersMP VTC is verified as theirs, so nobody can borrow another VTC's convoys. */
async function tachoCompanies(db: Database): Promise<TachoCompany[]> {
  const rows = await db.company.findMany({
    where: { truckersmpVtcId: { not: null }, verifiedAt: { not: null } },
    select: { name: true, slug: true, tag: true, truckersmpVtcId: true },
  });
  return rows.flatMap((c) =>
    c.truckersmpVtcId === null ? [] : [{ ...c, truckersmpVtcId: c.truckersmpVtcId }],
  );
}

/** Runs `fn` over `items`, at most `limit` at a time. */
async function mapLimited<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results: PromiseSettledResult<R>[] = [];
  for (let i = 0; i < items.length; i += limit) {
    results.push(...(await Promise.allSettled(items.slice(i, i + limit).map(fn))));
  }
  return results;
}

/**
 * Upcoming convoys hosted by any VTC on Tacho, soonest first. A VTC whose
 * TruckersMP lookup fails is skipped; `unavailable` is true only if all fail.
 *
 * Fine for the first dozens of VTCs thanks to the 10-minute cache in
 * packages/truckersmp. With hundreds, move this to a scheduled job.
 */
export async function tachoConvoys(
  db: Database,
  { limit = 20, excludeVtcId }: { limit?: number; excludeVtcId?: number | null } = {},
) {
  const companies = (await tachoCompanies(db)).filter((c) => c.truckersmpVtcId !== excludeVtcId);
  const results = await mapLimited(companies, 5, async (c) =>
    (await hostedEvents(c.truckersmpVtcId)).map((e): Convoy => ({
      ...e,
      hostedByVtc: true,
      company: { name: c.name, slug: c.slug, tag: c.tag },
    })),
  );
  const events = results
    .flatMap((r) => (r.status === "fulfilled" ? r.value : []))
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .slice(0, limit);
  const unavailable = companies.length > 0 && results.every((r) => r.status === "rejected");
  return { events, unavailable };
}

/** Convoys a company created itself on TruckersMP. */
export async function companyConvoys(
  company: { name: string; slug: string; tag: string | null; truckersmpVtcId: number },
  { limit = 5 } = {},
) {
  try {
    const events = await hostedEvents(company.truckersmpVtcId, { limit });
    return {
      events: events.map((e): Convoy => ({
        ...e,
        hostedByVtc: true,
        company: { name: company.name, slug: company.slug, tag: company.tag },
      })),
      unavailable: false,
    };
  } catch {
    return { events: [] as Convoy[], unavailable: true };
  }
}
