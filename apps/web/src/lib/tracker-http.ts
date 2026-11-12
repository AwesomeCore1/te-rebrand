// Helpers for the REST endpoints under /api/tracker/* (called by the tracker app).
import type { z } from "zod";

export function json(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

const MAX_BODY_BYTES = 64 * 1024;

/** Parses and validates a JSON body; returns a Response on failure. */
export async function readBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<{ ok: true; data: z.infer<T> } | { ok: false; response: Response }> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > MAX_BODY_BYTES) return { ok: false, response: json({ error: "too_large" }, 413) };
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { ok: false, response: json({ error: "invalid_json" }, 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      response: json({ error: "invalid_body", issues: parsed.error.issues }, 422),
    };
  }
  return { ok: true, data: parsed.data };
}
