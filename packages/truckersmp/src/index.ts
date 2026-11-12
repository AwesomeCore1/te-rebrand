// A small client for the public TruckersMP API (https://truckersmp.com/developers/api).
// No key needed. Responses are cached in memory so many VTCs and page views
// don't turn into many requests (docs/PLAN.md asks us to be gentle with it).
import { z } from "zod";

const BASE = "https://api.truckersmp.com/v2";
const SITE = "https://truckersmp.com";
const CACHE_TTL_MS = 10 * 60_000;

/** TruckersMP times look like "2026-11-13 18:00:00" and are UTC. */
const utcDate = z.string().transform((s, ctx) => {
  const d = new Date(`${s.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) {
    ctx.addIssue({ code: "custom", message: `not a date: ${s}` });
    return z.NEVER;
  }
  return d;
});
const place = z.object({ location: z.string().nullable(), city: z.string().nullable() }).nullable();

export const EventSchema = z.object({
  id: z.number(),
  name: z.string(),
  game: z.string(), // "ETS2" or "ATS"
  event_type: z.object({ key: z.string(), name: z.string() }).nullable(),
  server: z.object({ id: z.number(), name: z.string() }).nullable(),
  language: z.string().nullable(),
  departure: place,
  arrive: place,
  meetup_at: utcDate,
  start_at: utcDate,
  banner: z.string().nullable(),
  map: z.string().nullable(),
  /** Markdown, written by the event's organiser. */
  description: z.string().nullable(),
  /** Markdown. */
  rule: z.string().nullable(),
  voice_link: z.string().nullable(),
  external_link: z.string().nullable(),
  vtc: z.object({ id: z.number(), name: z.string() }).nullable(),
  attendances: z.object({ confirmed: z.number(), unsure: z.number(), vtcs: z.number() }).nullable(),
  url: z.string(),
});
type RawEvent = z.infer<typeof EventSchema>;

/** The shape the rest of the app uses. */
export type TmpEvent = {
  id: number;
  name: string;
  game: "ets2" | "ats";
  type: string | null;
  server: string | null;
  language: string | null;
  from: { city: string | null; location: string | null };
  to: { city: string | null; location: string | null };
  meetupAt: Date;
  startAt: Date;
  banner: string | null;
  map: string | null;
  description: string;
  rules: string;
  voiceLink: string | null;
  externalLink: string | null;
  vtc: { id: number; name: string } | null;
  attending: { confirmed: number; unsure: number; vtcs: number };
  /** The event's page on truckersmp.com. */
  url: string;
};

function normalise(e: RawEvent): TmpEvent {
  return {
    id: e.id,
    name: e.name,
    game: e.game.toUpperCase() === "ATS" ? "ats" : "ets2",
    type: e.event_type?.name ?? null,
    server: e.server?.name ?? null,
    language: e.language,
    from: { city: e.departure?.city ?? null, location: e.departure?.location ?? null },
    to: { city: e.arrive?.city ?? null, location: e.arrive?.location ?? null },
    meetupAt: e.meetup_at,
    startAt: e.start_at,
    banner: e.banner || null,
    map: e.map || null,
    description: e.description ?? "",
    rules: e.rule ?? "",
    voiceLink: e.voice_link || null,
    externalLink: e.external_link || null,
    vtc: e.vtc,
    attending: e.attendances ?? { confirmed: 0, unsure: 0, vtcs: 0 },
    url: new URL(e.url, SITE).toString(),
  };
}

export class TruckersMpError extends Error {}

const cache = new Map<string, { at: number; value: unknown }>();

async function get<T extends z.ZodType>(
  path: string,
  schema: T,
  fetchImpl: typeof fetch,
): Promise<z.infer<T>> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value as z.infer<T>;

  const res = await fetchImpl(`${BASE}${path}`, {
    headers: { accept: "application/json", "user-agent": "Tacho (VTC platform)" },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) throw new TruckersMpError(`TruckersMP ${path}: HTTP ${res.status}`);
  const envelope = z
    .object({ error: z.boolean(), response: z.unknown() })
    .safeParse(await res.json());
  if (!envelope.success) throw new TruckersMpError(`TruckersMP ${path}: unexpected response`);
  if (envelope.data.error) throw new TruckersMpError(`TruckersMP ${path}: error response`);
  const value = schema.safeParse(envelope.data.response);
  if (!value.success) throw new TruckersMpError(`TruckersMP ${path}: unexpected response`);
  cache.set(path, { at: Date.now(), value: value.data });
  return value.data as z.infer<T>;
}

/** Skip events that don't parse instead of failing the whole list. */
const lenientEvents = z.array(z.unknown()).transform((items) =>
  items.flatMap((item) => {
    const parsed = EventSchema.safeParse(item);
    return parsed.success ? [normalise(parsed.data)] : [];
  }),
);

const upcomingFirst = (events: TmpEvent[], now: Date, limit: number) =>
  events
    .filter((e) => e.startAt >= now)
    .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
    .slice(0, limit);

/** Only the upcoming convoys a VTC organises itself, soonest first. */
export async function hostedEvents(
  vtcId: number,
  { limit = 20, now = new Date(), fetchImpl = fetch } = {},
) {
  const own = await get(`/vtc/${vtcId}/events`, lenientEvents, fetchImpl);
  // TruckersMP lists events by VTC, but keep only ones it really hosts.
  return upcomingFirst(
    own.filter((e) => e.vtc?.id === vtcId),
    now,
    limit,
  );
}

export async function event(id: number, { fetchImpl = fetch } = {}) {
  const raw = await get(`/events/${id}`, z.unknown(), fetchImpl);
  const parsed = EventSchema.safeParse(raw);
  if (!parsed.success) throw new TruckersMpError(`TruckersMP event ${id}: unexpected response`);
  return normalise(parsed.data);
}

/** For tests. */
export function clearCache() {
  cache.clear();
}
