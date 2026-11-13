import { beforeEach, expect, test } from "bun:test";

import {
  clearCache,
  player,
  TruckersMpError,
  vtc,
  vtcMember,
  vtcMembers,
  vtcMembership,
  vtcStanding,
} from "./index";

// Shapes copied from real answers of api.truckersmp.com/v2 (2026-11-13), cut down.
const OWNER_STEAM = "76561198083585955";
const DRIVER_STEAM = "76561198040152026";
const LONER_STEAM = "76561198000000001";

const rawPlayer = (
  id: number,
  steam: string,
  inVtc: { id: number; memberID: number } | null,
): unknown => ({
  id,
  name: `player-${id}`,
  avatar: "https://static.truckersmp.com/avatarsN/1.png",
  // TruckersMP sends the number too; it is too big for a JS number, so only
  // the string may be read.
  steamID64: Number(steam),
  steamID: steam,
  banned: false,
  vtc: inVtc
    ? { ...inVtc, name: "Nordic Haulage", tag: "NH", inVTC: true }
    : { id: 0, name: "", tag: "", inVTC: false, memberID: 0 },
});

const rawVtc = (id: number, ownerId: number): unknown => ({
  id,
  name: "Nordic Haulage",
  owner_id: ownerId,
  owner_username: "kasper",
  slogan: "North by road",
  tag: "NH",
  logo: "https://static.truckersmp.com/images/vtc/logo/7.png",
  members_count: 2,
  recruitment: "Open",
  verified: false,
});

const rawMember = (
  id: number,
  userId: number,
  steam: string,
  role: { name: string; owner: boolean },
): unknown => ({
  id,
  user_id: userId,
  username: `player-${userId}`,
  steam_id: Number(steam),
  steamID64: Number(steam),
  steamID: steam,
  roles: [{ id: 1, name: role.name, order: 0, owner: role.owner }],
  role_id: 1,
  role: role.name,
  is_owner: false,
  joinDate: "2019-07-13 14:26:50",
});

function fakeFetch(routes: Record<string, unknown>, status: Record<string, number> = {}) {
  const calls: string[] = [];
  const impl = (async (url: string) => {
    const path = new URL(url).pathname.replace("/v2", "");
    calls.push(path);
    if (path in status) return new Response("nope", { status: status[path] });
    if (!(path in routes)) {
      return Response.json({ error: true, descriptor: "Page not found" }, { status: 404 });
    }
    return Response.json({ error: false, response: routes[path] });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

beforeEach(clearCache);

test("player: found by SteamID64, with the VTC they are in", async () => {
  const { impl, calls } = fakeFetch({
    [`/player/${OWNER_STEAM}`]: rawPlayer(100, OWNER_STEAM, { id: 7, memberID: 1 }),
  });
  const p = await player(OWNER_STEAM, { fetchImpl: impl });
  expect(p).toEqual({
    id: 100,
    name: "player-100",
    // Exact, not the rounded number.
    steamId64: OWNER_STEAM,
    avatar: "https://static.truckersmp.com/avatarsN/1.png",
    banned: false,
    vtc: { id: 7, name: "Nordic Haulage", tag: "NH", memberId: 1 },
  });
  expect(calls).toEqual([`/player/${OWNER_STEAM}`]);
});

test("player: not in a VTC, and no TruckersMP account at all", async () => {
  const { impl, calls } = fakeFetch({
    [`/player/${LONER_STEAM}`]: rawPlayer(300, LONER_STEAM, null),
  });
  expect((await player(LONER_STEAM, { fetchImpl: impl }))?.vtc).toBeNull();
  expect(await player(DRIVER_STEAM, { fetchImpl: impl })).toBeNull();
  // A missing player is remembered too, so it isn't asked for again.
  expect(await player(DRIVER_STEAM, { fetchImpl: impl })).toBeNull();
  expect(calls).toEqual([`/player/${LONER_STEAM}`, `/player/${DRIVER_STEAM}`]);
  // Not a number at all: no request.
  expect(await player("abc", { fetchImpl: impl })).toBeNull();
  expect(calls).toHaveLength(2);
});

test("vtc: by id, null when TruckersMP has none", async () => {
  const { impl } = fakeFetch({ "/vtc/7": rawVtc(7, 100) });
  expect(await vtc(7, { fetchImpl: impl })).toEqual({
    id: 7,
    name: "Nordic Haulage",
    tag: "NH",
    logo: "https://static.truckersmp.com/images/vtc/logo/7.png",
    slogan: "North by road",
    ownerId: 100,
    ownerName: "kasper",
    membersCount: 2,
    verifiedByTruckersMp: false,
    url: "https://truckersmp.com/vtc/7",
  });
  expect(await vtc(8, { fetchImpl: impl })).toBeNull();
  expect(await vtc(0, { fetchImpl: impl })).toBeNull();
});

test("standing: the listed owner owns it, without a third request", async () => {
  const { impl, calls } = fakeFetch({
    [`/player/${OWNER_STEAM}`]: rawPlayer(100, OWNER_STEAM, { id: 7, memberID: 1 }),
    "/vtc/7": rawVtc(7, 100),
  });
  const s = await vtcStanding(OWNER_STEAM, { fetchImpl: impl });
  expect(s.status).toBe("owner");
  expect(calls).toEqual([`/player/${OWNER_STEAM}`, "/vtc/7"]);
});

test("standing: an ordinary member is not an owner", async () => {
  const { impl } = fakeFetch({
    [`/player/${DRIVER_STEAM}`]: rawPlayer(200, DRIVER_STEAM, { id: 7, memberID: 2 }),
    "/vtc/7": rawVtc(7, 100),
    "/vtc/7/member/2": rawMember(2, 200, DRIVER_STEAM, { name: "Driver", owner: false }),
  });
  const s = await vtcStanding(DRIVER_STEAM, { fetchImpl: impl });
  expect(s.status).toBe("member");
  if (s.status === "member") expect(s.vtc.name).toBe("Nordic Haulage");
});

test("standing: a member with an owner role counts as owner", async () => {
  const { impl } = fakeFetch({
    [`/player/${DRIVER_STEAM}`]: rawPlayer(200, DRIVER_STEAM, { id: 7, memberID: 2 }),
    "/vtc/7": rawVtc(7, 100),
    "/vtc/7/member/2": rawMember(2, 200, DRIVER_STEAM, { name: "Co-owner", owner: true }),
  });
  expect((await vtcStanding(DRIVER_STEAM, { fetchImpl: impl })).status).toBe("owner");
});

test("standing: a member record that belongs to someone else proves nothing", async () => {
  const { impl } = fakeFetch({
    [`/player/${DRIVER_STEAM}`]: rawPlayer(200, DRIVER_STEAM, { id: 7, memberID: 2 }),
    "/vtc/7": rawVtc(7, 100),
    "/vtc/7/member/2": rawMember(2, 999, OWNER_STEAM, { name: "Owner", owner: true }),
  });
  expect((await vtcStanding(DRIVER_STEAM, { fetchImpl: impl })).status).toBe("member");
});

test("standing: no VTC, no TruckersMP account, not a SteamID64", async () => {
  const { impl, calls } = fakeFetch({
    [`/player/${LONER_STEAM}`]: rawPlayer(300, LONER_STEAM, null),
  });
  expect((await vtcStanding(LONER_STEAM, { fetchImpl: impl })).status).toBe("no_vtc");
  expect((await vtcStanding(DRIVER_STEAM, { fetchImpl: impl })).status).toBe("no_player");
  expect((await vtcStanding("1234", { fetchImpl: impl })).status).toBe("no_player");
  expect(calls).toHaveLength(2);
});

test("membership: in this VTC, in another one, or not on TruckersMP", async () => {
  const { impl } = fakeFetch({
    [`/player/${DRIVER_STEAM}`]: rawPlayer(200, DRIVER_STEAM, { id: 7, memberID: 2 }),
  });
  expect((await vtcMembership(DRIVER_STEAM, 7, { fetchImpl: impl })).member).toBe(true);
  expect((await vtcMembership(DRIVER_STEAM, 8, { fetchImpl: impl })).member).toBe(false);
  expect(await vtcMembership(LONER_STEAM, 7, { fetchImpl: impl })).toEqual({
    member: false,
    player: null,
  });
});

test("members: the whole VTC in one request; a short list is marked incomplete", async () => {
  const members = [
    rawMember(1, 100, OWNER_STEAM, { name: "Owner", owner: true }),
    rawMember(2, 200, DRIVER_STEAM, { name: "Driver", owner: false }),
  ];
  const { impl, calls } = fakeFetch({
    "/vtc/7/members": { members, members_count: 2 },
    "/vtc/8/members": { members: [members[0], { id: "broken" }], members_count: 2 },
    "/vtc/9/members": { members: [members[0]], members_count: 40 },
  });
  const full = await vtcMembers(7, { fetchImpl: impl });
  expect(full?.complete).toBe(true);
  expect(full?.members.map((m) => [m.steamId64, m.isOwner])).toEqual([
    [OWNER_STEAM, true],
    [DRIVER_STEAM, false],
  ]);
  expect(full?.members[0]?.joinedAt?.toISOString()).toBe("2019-07-13T14:26:50.000Z");
  expect((await vtcMembers(8, { fetchImpl: impl }))?.complete).toBe(false);
  expect((await vtcMembers(9, { fetchImpl: impl }))?.complete).toBe(false);
  expect(await vtcMembers(10, { fetchImpl: impl })).toBeNull();
  expect(calls).toHaveLength(4);
  expect(await vtcMember(7, 5, { fetchImpl: impl })).toBeNull();
});

test("cache: answers are reused, unless the caller wants a fresh one", async () => {
  const { impl, calls } = fakeFetch({ "/vtc/7": rawVtc(7, 100) });
  await vtc(7, { fetchImpl: impl });
  await vtc(7, { fetchImpl: impl });
  expect(calls).toHaveLength(1);
  await vtc(7, { fetchImpl: impl, maxAgeMs: 0 });
  expect(calls).toHaveLength(2);
});

test("errors: a rate limit or outage throws with the status, and is not cached", async () => {
  const { impl, calls } = fakeFetch({}, { "/vtc/7": 429 });
  const err = await vtc(7, { fetchImpl: impl }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(TruckersMpError);
  expect((err as TruckersMpError).status).toBe(429);
  await vtc(7, { fetchImpl: impl }).catch(() => null);
  expect(calls).toHaveLength(2);

  const down = (async () => {
    throw new Error("connect ECONNREFUSED");
  }) as unknown as typeof fetch;
  const offline = await player(OWNER_STEAM, { fetchImpl: down }).catch((e: unknown) => e);
  expect(offline).toBeInstanceOf(TruckersMpError);
  expect((offline as TruckersMpError).status).toBeNull();
});

test("an answer in an unexpected shape throws instead of guessing", async () => {
  const { impl } = fakeFetch({ [`/player/${OWNER_STEAM}`]: { id: "x" } });
  await expect(player(OWNER_STEAM, { fetchImpl: impl })).rejects.toThrow("unexpected response");
});
