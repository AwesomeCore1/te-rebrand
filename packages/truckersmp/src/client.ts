// The one place that talks to the public TruckersMP API
// (https://truckersmp.com/developers/api). No key needed, but it is rate
// limited: every response is cached in memory, and callers that walk a list
// (the nightly membership check) must pace themselves.
import { z } from "zod";

const BASE = "https://api.truckersmp.com/v2";
export const SITE = "https://truckersmp.com";
export const CACHE_TTL_MS = 10 * 60_000;

export class TruckersMpError extends Error {
  /** The HTTP status, when TruckersMP answered at all. */
  readonly status: number | null;
  constructor(message: string, status: number | null = null) {
    super(message);
    this.name = "TruckersMpError";
    this.status = status;
  }
}

export type RequestOptions = {
  fetchImpl?: typeof fetch;
  /**
   * How old a cached answer may be. Default 10 minutes. Checks that decide
   * something (who owns a VTC, who is a member) pass a shorter time so a driver
   * who just changed things on TruckersMP isn't told an old answer.
   */
  maxAgeMs?: number;
};

/** Cached in place of a value when TruckersMP says 404, so a missing player isn't asked for again and again. */
const NOT_FOUND = Symbol("not found");
const cache = new Map<string, { at: number; value: unknown }>();

export async function get<T extends z.ZodType>(
  path: string,
  schema: T,
  { fetchImpl = fetch, maxAgeMs = CACHE_TTL_MS }: RequestOptions = {},
): Promise<z.infer<T>> {
  const notFound = () => new TruckersMpError(`TruckersMP ${path}: HTTP 404`, 404);
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < maxAgeMs) {
    if (hit.value === NOT_FOUND) throw notFound();
    return hit.value as z.infer<T>;
  }

  let res: Response;
  try {
    res = await fetchImpl(`${BASE}${path}`, {
      headers: { accept: "application/json", "user-agent": "Tacho (VTC platform)" },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (e) {
    throw new TruckersMpError(
      `TruckersMP ${path}: ${e instanceof Error ? e.message : "request failed"}`,
    );
  }
  if (res.status === 404) {
    cache.set(path, { at: Date.now(), value: NOT_FOUND });
    throw notFound();
  }
  if (!res.ok) throw new TruckersMpError(`TruckersMP ${path}: HTTP ${res.status}`, res.status);
  const envelope = z
    .object({ error: z.boolean(), response: z.unknown() })
    .safeParse(await res.json().catch(() => null));
  if (!envelope.success) {
    throw new TruckersMpError(`TruckersMP ${path}: unexpected response`, res.status);
  }
  if (envelope.data.error) {
    throw new TruckersMpError(`TruckersMP ${path}: error response`, res.status);
  }
  const value = schema.safeParse(envelope.data.response);
  if (!value.success) {
    throw new TruckersMpError(`TruckersMP ${path}: unexpected response`, res.status);
  }
  cache.set(path, { at: Date.now(), value: value.data });
  return value.data as z.infer<T>;
}

/** Like `get`, but a 404 is an answer (null), not an error. */
export async function getOrNull<T extends z.ZodType>(
  path: string,
  schema: T,
  options?: RequestOptions,
): Promise<z.infer<T> | null> {
  try {
    return await get(path, schema, options);
  } catch (e) {
    if (e instanceof TruckersMpError && e.status === 404) return null;
    throw e;
  }
}

/** TruckersMP times look like "2026-11-13 18:00:00" and are UTC. */
export const utcDate = z.string().transform((s, ctx) => {
  const d = new Date(`${s.replace(" ", "T")}Z`);
  if (Number.isNaN(d.getTime())) {
    ctx.addIssue({ code: "custom", message: `not a date: ${s}` });
    return z.NEVER;
  }
  return d;
});

/** For tests. */
export function clearCache() {
  cache.clear();
}
