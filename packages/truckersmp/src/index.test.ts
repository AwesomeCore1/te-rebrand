import { beforeEach, expect, test } from "bun:test";

import { clearCache, event, hostedEvents } from "./index";

const raw = (id: number, start: string, vtc = 7) => ({
  id,
  name: `Convoy ${id}`,
  slug: `convoy-${id}`,
  game: "ETS2",
  event_type: { key: "convoy", name: "Convoy" },
  server: { id: 1, name: "Simulation 1" },
  language: "English",
  departure: { location: "Garage", city: "Hamburg" },
  arrive: { location: "Port", city: "Rotterdam" },
  meetup_at: start,
  start_at: start,
  banner: "https://static.truckersmp.com/x.png",
  map: "",
  description: "**Bring** a *Scania*.",
  rule: "* No overtaking",
  voice_link: "",
  external_link: "",
  featured: "",
  vtc: { id: vtc, name: "Nordic Haulage" },
  user: { id: 1, username: "kasper" },
  attendances: { confirmed: 12, unsure: 3, vtcs: 2 },
  dlcs: [],
  url: `/events/${id}-convoy`,
  created_at: start,
  updated_at: start,
});

function fakeFetch(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    const path = new URL(url).pathname.replace("/v2", "");
    calls.push(path);
    if (!(path in routes)) return new Response("not found", { status: 404 });
    return Response.json({ error: false, response: routes[path] });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const NOW = new Date("2026-11-12T12:00:00Z");
beforeEach(clearCache);

test("hosted events: only the VTC's own, upcoming, and malformed ones skipped", async () => {
  const { impl } = fakeFetch({
    "/vtc/7/events": [
      { id: "nope" },
      raw(1, "2024-02-10 17:00:00"),
      raw(6, "2026-11-19 18:00:00", 99),
      raw(5, "2026-11-13 18:00:00"),
    ],
  });
  const events = await hostedEvents(7, { now: NOW, fetchImpl: impl });
  expect(events.map((e) => e.id)).toEqual([5]);
  // TruckersMP times are UTC; links point at truckersmp.com.
  expect(events[0]!.startAt.toISOString()).toBe("2026-11-13T18:00:00.000Z");
  expect(events[0]!.url).toBe("https://truckersmp.com/events/5-convoy");
  expect(events[0]!.description).toBe("**Bring** a *Scania*.");
});

test("caches responses", async () => {
  const { impl, calls } = fakeFetch({ "/events/5": raw(5, "2026-11-13 18:00:00") });
  await event(5, { fetchImpl: impl });
  await event(5, { fetchImpl: impl });
  expect(calls).toEqual(["/events/5"]);
});

test("throws on an error response", async () => {
  const { impl } = fakeFetch({});
  await expect(event(404, { fetchImpl: impl })).rejects.toThrow("HTTP 404");
});
