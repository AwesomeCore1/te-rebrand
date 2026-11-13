import { expect, test } from "bun:test";

import type { Context } from "./context";
import { createLiveHub, type LiveMessage, type LiveScope, newLiveHubState } from "./live";
import { canWatchCompany } from "./routers/live";
import { type LivePosition, POSITION_TTL_MS, recordPosition } from "./tracker";

// The position store is shared by every test in the process, so each test
// gets its own hour: whatever an earlier test stored has expired by then.
let clock = Date.parse("2026-11-13T08:00:00Z");
const nextHour = () => (clock += 3_600_000);

const PUBLIC: LiveScope = { kind: "public" };
const company = (companyId: string): LiveScope => ({ kind: "company", companyId });

function position(now: number, over: Partial<LivePosition> & { driverId: string }): LivePosition {
  return {
    game: "ets2",
    multiplayer: true,
    server: "Simulation 1",
    x: 100,
    z: -200,
    speed_kmh: 80,
    at: new Date(now).toISOString(),
    displayName: over.driverId,
    companyId: null,
    showOnLiveMap: true,
    receivedAt: now,
    ...over,
  };
}

/** A hub on the real store, with one inbox per listener. */
function setup() {
  const hub = createLiveHub();
  const send = (p: LivePosition) => {
    recordPosition(p);
    hub.publish(p);
  };
  const listen = (scope: LiveScope, now: number) => {
    const inbox: LiveMessage[] = [];
    const stop = hub.subscribe(scope, (m) => inbox.push(m), now);
    if (!stop) throw new Error("hub is full");
    return { inbox, stop };
  };
  return { hub, send, listen };
}

const updates = (inbox: LiveMessage[]) =>
  inbox.flatMap((m) => (m.type === "update" ? [m.driver.driverId] : []));
const removes = (inbox: LiveMessage[]) =>
  inbox.flatMap((m) => (m.type === "remove" ? [m.driverId] : []));
const snapshotIds = (inbox: LiveMessage[]) =>
  inbox.flatMap((m) => (m.type === "snapshot" ? m.drivers.map((d) => d.driverId) : [])).sort();

test("public stream: only drivers who allow it, and hiding removes them", () => {
  const now = nextHour();
  const { send, listen } = setup();
  send(position(now, { driverId: "open", companyId: "c1" }));
  send(position(now, { driverId: "private", companyId: "c1", showOnLiveMap: false }));

  const pub = listen(PUBLIC, now);
  const own = listen(company("c1"), now);
  expect(snapshotIds(pub.inbox)).toEqual(["open"]);
  expect(snapshotIds(own.inbox)).toEqual(["open", "private"]);

  send(position(now + 5_000, { driverId: "private", companyId: "c1", showOnLiveMap: false }));
  expect(updates(pub.inbox)).toEqual([]);
  expect(updates(own.inbox)).toEqual(["private"]);

  // "open" turns the toggle off: gone from the public map, still on the company's.
  send(position(now + 10_000, { driverId: "open", companyId: "c1", showOnLiveMap: false }));
  expect(removes(pub.inbox)).toEqual(["open"]);
  expect(updates(pub.inbox)).toEqual([]);
  expect(updates(own.inbox)).toEqual(["private", "open"]);
  expect(removes(own.inbox)).toEqual([]);

  // And back on.
  send(position(now + 15_000, { driverId: "open", companyId: "c1" }));
  expect(updates(pub.inbox)).toEqual(["open"]);
});

test("company stream: one company never sees another's drivers", () => {
  const now = nextHour();
  const { send, listen } = setup();
  send(position(now, { driverId: "a1", companyId: "c1", showOnLiveMap: false }));
  send(position(now, { driverId: "b1", companyId: "c2", showOnLiveMap: false }));
  send(position(now, { driverId: "solo", companyId: null }));

  const c1 = listen(company("c1"), now);
  const c2 = listen(company("c2"), now);
  expect(snapshotIds(c1.inbox)).toEqual(["a1"]);
  expect(snapshotIds(c2.inbox)).toEqual(["b1"]);

  send(position(now + 5_000, { driverId: "b1", companyId: "c2", showOnLiveMap: false }));
  send(position(now + 5_000, { driverId: "solo", companyId: null }));
  expect(updates(c1.inbox)).toEqual([]);
  expect(updates(c2.inbox)).toEqual(["b1"]);

  // a1 moves from c1 to c2: c1 loses them, c2 gains them.
  send(position(now + 10_000, { driverId: "a1", companyId: "c2", showOnLiveMap: false }));
  expect(removes(c1.inbox)).toEqual(["a1"]);
  expect(updates(c1.inbox)).toEqual([]);
  expect(updates(c2.inbox)).toEqual(["b1", "a1"]);
});

test("viewers never get the company id or the privacy flag", () => {
  const now = nextHour();
  const { send, listen } = setup();
  send(position(now, { driverId: "d", companyId: "c1" }));
  const pub = listen(PUBLIC, now);
  send(position(now + 5_000, { driverId: "d", companyId: "c1", x: 7 }));
  const wire = JSON.stringify(pub.inbox);
  expect(wire).not.toContain("companyId");
  expect(wire).not.toContain("showOnLiveMap");
  expect(wire).not.toContain("receivedAt");
  expect(pub.inbox.at(-1)).toEqual({
    type: "update",
    driver: {
      driverId: "d",
      displayName: "d",
      game: "ets2",
      multiplayer: true,
      server: "Simulation 1",
      x: 7,
      z: -200,
      speed_kmh: 80,
    },
  });
});

test("a driver who stops sending disappears from open maps after the TTL", () => {
  const now = nextHour();
  const { hub, send, listen } = setup();
  send(position(now, { driverId: "stopped" }));
  send(position(now, { driverId: "driving" }));
  const pub = listen(PUBLIC, now);

  send(position(now + 20_000, { driverId: "driving" }));
  hub.sweep(now + POSITION_TTL_MS); // exactly the TTL: still shown
  expect(removes(pub.inbox)).toEqual([]);
  hub.sweep(now + POSITION_TTL_MS + 1);
  expect(removes(pub.inbox)).toEqual(["stopped"]);
  hub.sweep(now + POSITION_TTL_MS + 1_000); // told once, not every sweep
  expect(removes(pub.inbox)).toEqual(["stopped"]);

  // Someone opening the map now doesn't get the expired driver either.
  const late = listen(PUBLIC, now + POSITION_TTL_MS + 1);
  expect(snapshotIds(late.inbox)).toEqual(["driving"]);

  // Driving again brings them back.
  send(position(now + 40_000, { driverId: "stopped" }));
  expect(updates(pub.inbox).at(-1)).toBe("stopped");
});

test("positions stored before anyone listened still expire", () => {
  const now = nextHour();
  const { hub, listen } = setup();
  // Stored without the hub hearing about it (as after a hot reload).
  recordPosition(position(now, { driverId: "early" }));
  const pub = listen(PUBLIC, now + 10_000);
  expect(snapshotIds(pub.inbox)).toEqual(["early"]);
  hub.sweep(now + POSITION_TTL_MS + 1);
  expect(removes(pub.inbox)).toEqual(["early"]);
});

test("unsubscribing on disconnect stops delivery", () => {
  const now = nextHour();
  const { hub, send, listen } = setup();
  const a = listen(PUBLIC, now);
  const b = listen(PUBLIC, now);
  expect(hub.subscriberCount).toBe(2);

  a.stop();
  expect(hub.subscriberCount).toBe(1);
  send(position(now, { driverId: "d" }));
  expect(updates(a.inbox)).toEqual([]);
  expect(updates(b.inbox)).toEqual(["d"]);

  a.stop(); // closing twice is harmless
  b.stop();
  expect(hub.subscriberCount).toBe(0);
  send(position(now + 5_000, { driverId: "d" })); // nobody listening: no error
});

test("a listener whose connection throws is dropped without hurting the others", () => {
  const now = nextHour();
  const { hub, send, listen } = setup();
  let open = true;
  hub.subscribe(
    PUBLIC,
    () => {
      if (!open) throw new Error("socket closed");
    },
    now,
  );
  const healthy = listen(PUBLIC, now);
  open = false;
  send(position(now, { driverId: "d" }));
  expect(updates(healthy.inbox)).toEqual(["d"]);
  expect(hub.subscriberCount).toBe(1);
  healthy.stop();
});

test("turns listeners away at the limit, and takes new ones once there's room", () => {
  const now = nextHour();
  const hub = createLiveHub({ maxSubscribers: 1 });
  const first = hub.subscribe(PUBLIC, () => {}, now);
  expect(first).not.toBeNull();
  expect(hub.subscribe(PUBLIC, () => {}, now)).toBeNull();
  first?.();
  const again = hub.subscribe(PUBLIC, () => {}, now);
  expect(again).not.toBeNull();
  again?.();
});

test("pings listeners so a quiet map isn't mistaken for a dead connection", () => {
  const now = nextHour();
  const { hub, listen } = setup();
  const pub = listen(PUBLIC, now);
  const pings = () => pub.inbox.filter((m) => m.type === "ping").length;
  hub.sweep(now + 19_000);
  expect(pings()).toBe(0);
  hub.sweep(now + 20_000);
  hub.sweep(now + 21_000);
  expect(pings()).toBe(1);
  hub.sweep(now + 40_000);
  expect(pings()).toBe(2);
  pub.stop();
});

test("a reloaded hub on the same state takes over the open connections", () => {
  const now = nextHour();
  const state = newLiveHubState();
  // The first copy of the module, reading a store that is about to be replaced.
  const before = createLiveHub({ snapshot: () => [] }, state);
  const inbox: LiveMessage[] = [];
  const stop = before.subscribe(PUBLIC, (m) => inbox.push(m), now);

  // Hot reload: a second hub on the same state, reading the current store.
  const current = [position(now, { driverId: "d" })];
  const after = createLiveHub({ snapshot: () => current }, state);
  expect(after.subscriberCount).toBe(1);

  // The old connection hears what the new copy publishes...
  after.publish(position(now + 5_000, { driverId: "d" }));
  expect(updates(inbox)).toEqual(["d"]);
  // ...a new connection gets its snapshot from the current store...
  const late: LiveMessage[] = [];
  const stopLate = after.subscribe(PUBLIC, (m) => late.push(m), now + 5_000);
  expect(snapshotIds(late)).toEqual(["d"]);
  // ...expiry still reaches both, and the old connection can still hang up.
  after.sweep(now + 5_000 + POSITION_TTL_MS + 1);
  expect(removes(inbox)).toEqual(["d"]);
  expect(removes(late)).toEqual(["d"]);
  stop?.();
  stopLate?.();
  expect(after.subscriberCount).toBe(0);
  expect(state.timer).toBeUndefined();
});

// ---- Who may open a company stream ------------------------------------------
// canWatchCompany runs the real companyProcedure middleware; only the database
// is a stand-in.

type MembershipRow = { companyId: string; driverId: string; status: string; role: string };

function fakeContext(userId: string | null, memberships: MembershipRow[]): Context {
  const db = {
    driver: {
      upsert: async ({ where }: { where: { userId: string } }) => ({
        id: `driver-of-${where.userId}`,
        userId: where.userId,
      }),
    },
    membership: {
      findFirst: async ({ where }: { where: Partial<MembershipRow> }) =>
        memberships.find((m) =>
          Object.entries(where).every(([k, v]) => m[k as keyof MembershipRow] === v),
        ) ?? null,
    },
  };
  const session = userId ? { user: { id: userId, name: "Test" }, session: {} } : null;
  return { db, session } as unknown as Context;
}

test("company stream gate: active members of that company only", async () => {
  const rows: MembershipRow[] = [
    { companyId: "c1", driverId: "driver-of-anna", status: "active", role: "driver" },
    { companyId: "c2", driverId: "driver-of-bo", status: "active", role: "owner" },
    { companyId: "c1", driverId: "driver-of-carl", status: "left", role: "driver" },
    { companyId: "c1", driverId: "driver-of-dina", status: "pending", role: "driver" },
    { companyId: "c1", driverId: "driver-of-egil", status: "removed", role: "manager" },
  ];
  expect(await canWatchCompany(fakeContext("anna", rows), "c1")).toBe(true);
  expect(await canWatchCompany(fakeContext("anna", rows), "c2")).toBe(false);
  // An owner elsewhere is still nobody here.
  expect(await canWatchCompany(fakeContext("bo", rows), "c1")).toBe(false);
  expect(await canWatchCompany(fakeContext("bo", rows), "c2")).toBe(true);
  // Former, pending and removed members.
  expect(await canWatchCompany(fakeContext("carl", rows), "c1")).toBe(false);
  expect(await canWatchCompany(fakeContext("dina", rows), "c1")).toBe(false);
  expect(await canWatchCompany(fakeContext("egil", rows), "c1")).toBe(false);
  // Not logged in, unknown company, empty id.
  expect(await canWatchCompany(fakeContext(null, rows), "c1")).toBe(false);
  expect(await canWatchCompany(fakeContext("anna", rows), "nope")).toBe(false);
  expect(await canWatchCompany(fakeContext("anna", rows), "")).toBe(false);
});

test("company stream gate: a database failure is an error, not a refusal or a pass", async () => {
  const ctx = fakeContext("anna", []);
  (ctx.db.membership as unknown as { findFirst: () => Promise<never> }).findFirst = async () => {
    throw new Error("connection refused");
  };
  await expect(canWatchCompany(ctx, "c1")).rejects.toThrow();
});
