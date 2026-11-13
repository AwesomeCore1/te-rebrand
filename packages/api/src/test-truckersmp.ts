// A pretend TruckersMP for tests: a few VTCs and players, answered in the same
// JSON the real API sends (see packages/truckersmp/src/identity.test.ts). Tests
// change `vtcs` and `players` to act out someone joining or leaving a VTC.
import type { Database } from "@te-rebrand/db";

let nextSteam = 0;
/** A SteamID64 no other test uses. */
export function steamId() {
  nextSteam++;
  const unique = `${Date.now() % 1_000_000}${String(nextSteam).padStart(4, "0")}`;
  return `7656119${unique.padStart(10, "0")}`;
}

let nextVtc = Math.floor(Math.random() * 1_000_000) * 100 + 1_000_000;
/** A TruckersMP VTC id no other test uses. */
export function vtcId() {
  return nextVtc++;
}

/** Gives a test driver a linked Steam account. */
export async function linkSteam<T extends { id: string }>(db: Database, driver: T) {
  const steamId64 = steamId();
  await db.driver.update({ where: { id: driver.id }, data: { steamId64 } });
  return { ...driver, steamId64, truckersmpId: null as number | null };
}

// TruckersMP user ids, unique across every fake in a test run (the column is unique).
let nextId = Math.floor(Math.random() * 1_000_000) * 1000 + 10_000_000;

type FakePlayer = { id: number; steam: string; vtcId: number | null };
type FakeVtc = { id: number; name: string; tag: string; ownerSteam: string; coOwners?: string[] };

export function fakeTruckersMp() {
  const players = new Map<string, FakePlayer>();
  const vtcs = new Map<number, FakeVtc>();
  const calls: string[] = [];
  /** Paths that answer with this HTTP status instead (429, 500, ...). */
  const broken = new Map<string, number>();
  /** VTCs whose member list comes back cut to this many. */
  const shortLists = new Map<number, number>();
  let offline = false;

  const membersOf = (vtc: FakeVtc) =>
    [...players.values()]
      .filter((p) => p.vtcId === vtc.id)
      .map((p) => {
        const owner = p.steam === vtc.ownerSteam;
        const coOwner = vtc.coOwners?.includes(p.steam) ?? false;
        return {
          id: p.id + 50_000,
          user_id: p.id,
          username: `tmp-${p.id}`,
          steamID64: Number(p.steam),
          steamID: p.steam,
          roles: [{ id: 1, name: owner ? "Owner" : "Driver", order: 0, owner: owner || coOwner }],
          role: owner ? "Owner" : "Driver",
          is_owner: owner,
          joinDate: "2024-01-01 12:00:00",
        };
      });

  function answer(path: string): unknown {
    const [, kind, id, sub, subId] = path.split("/");
    if (kind === "player") {
      const p = players.get(id!);
      if (!p) return undefined;
      const vtc = p.vtcId === null ? undefined : vtcs.get(p.vtcId);
      return {
        id: p.id,
        name: `tmp-${p.id}`,
        avatar: null,
        steamID64: Number(p.steam),
        steamID: p.steam,
        banned: false,
        vtc: vtc
          ? { id: vtc.id, name: vtc.name, tag: vtc.tag, inVTC: true, memberID: p.id + 50_000 }
          : { id: 0, name: "", tag: "", inVTC: false, memberID: 0 },
      };
    }
    const vtc = kind === "vtc" ? vtcs.get(Number(id)) : undefined;
    if (!vtc) return undefined;
    const members = membersOf(vtc);
    if (!sub) {
      const owner = players.get(vtc.ownerSteam);
      return {
        id: vtc.id,
        name: vtc.name,
        owner_id: owner?.id ?? 1,
        owner_username: owner ? `tmp-${owner.id}` : "someone",
        slogan: "",
        tag: vtc.tag,
        logo: `https://static.truckersmp.com/images/vtc/logo/${vtc.id}.png`,
        members_count: members.length,
        recruitment: "Open",
        verified: false,
      };
    }
    if (sub === "members") {
      const cut = shortLists.get(vtc.id);
      return {
        members: cut === undefined ? members : members.slice(0, cut),
        members_count: members.length,
      };
    }
    if (sub === "member") return members.find((m) => m.id === Number(subId));
    if (sub === "events") return [];
    return undefined;
  }

  const fetchImpl = (async (url: string) => {
    const path = new URL(url).pathname.replace("/v2", "");
    calls.push(path);
    if (offline) throw new Error("connect ECONNREFUSED");
    const status = broken.get(path);
    if (status) return new Response("nope", { status });
    const response = answer(path);
    if (response === undefined) {
      return Response.json({ error: true, descriptor: "Page not found" }, { status: 404 });
    }
    return Response.json({ error: false, response });
  }) as unknown as typeof fetch;

  return {
    fetchImpl,
    calls,
    broken,
    shortLists,
    setOffline: (value: boolean) => (offline = value),
    /** A VTC, owned by the driver with this SteamID64 (who is put in it). */
    addVtc(name: string, ownerSteam: string, extra: Partial<FakeVtc> = {}) {
      const vtc = { id: vtcId(), name, tag: "TST", ownerSteam, ...extra };
      vtcs.set(vtc.id, vtc);
      this.join(ownerSteam, vtc.id);
      return vtc;
    },
    /** Puts a Steam account in a VTC, creating its TruckersMP account if needed. */
    join(steam: string, intoVtcId: number | null) {
      const existing = players.get(steam);
      if (existing) existing.vtcId = intoVtcId;
      else players.set(steam, { id: nextId++, steam, vtcId: intoVtcId });
      return players.get(steam)!;
    },
    /** A TruckersMP account that is in no VTC. */
    leave(steam: string) {
      return this.join(steam, null);
    },
    vtcs,
    players,
  };
}
