import { beforeEach, expect, test } from "bun:test";

import { clearCache } from "@te-rebrand/truckersmp";
import { TRPCError } from "@trpc/server";

import { createCompany, freeSlug, registrationStatus, slugify } from "./companies";
import { makeCompany, makeDriver, testDb } from "./test-db";
import { fakeTruckersMp, linkSteam } from "./test-truckersmp";

const db = await testDb();
beforeEach(clearCache);

const NOW = new Date("2026-11-13T10:00:00Z");
const code = (e: unknown) => (e instanceof TRPCError ? e.code : `not a TRPCError: ${String(e)}`);
const fails = (p: Promise<unknown>) => p.then(() => "did not fail", code);

test("slugs: plain Latin, no reserved words, never empty", async () => {
  expect(slugify("Nordic Haulage ™")).toBe("nordic-haulage");
  expect(slugify("  Ünïted   Trück--Lines!  ")).toBe("united-truck-lines");
  expect(slugify("北方运输")).toBe("");
  const none = async () => false;
  expect(await freeSlug(none, "北方运输", 77)).toBe("vtc-77");
  // /vtc/new is the sign-up page, so no company may sit there.
  expect(await freeSlug(none, "New", 5)).toBe("new-vtc");
  const taken = new Set(["nordic-haulage", "nordic-haulage-2"]);
  expect(await freeSlug(async (s) => taken.has(s), "Nordic Haulage", 5)).toBe("nordic-haulage-3");
});

test("the VTC's owner on TruckersMP registers it and becomes owner here", async () => {
  const tmp = fakeTruckersMp();
  const owner = await linkSteam(db, await makeDriver(db));
  const vtc = tmp.addVtc("Fjord Freight", owner.steamId64);

  const before = await registrationStatus(db, owner, tmp);
  expect(before.status).toBe("ready");
  if (before.status !== "ready") return;
  expect(before.vtc).toMatchObject({ id: vtc.id, name: "Fjord Freight", tag: "TST" });

  const company = await createCompany(db, owner, { vtcId: vtc.id }, { ...tmp, now: NOW });
  const row = await db.company.findUniqueOrThrow({
    where: { id: company.id },
    include: { memberships: true },
  });
  expect(row).toMatchObject({
    name: "Fjord Freight",
    tag: "TST",
    truckersmpVtcId: vtc.id,
    verifiedAt: NOW,
    logoUrl: `https://static.truckersmp.com/images/vtc/logo/${vtc.id}.png`,
  });
  expect(row.slug).toStartWith("fjord-freight");
  expect(row.memberships).toHaveLength(1);
  expect(row.memberships[0]).toMatchObject({
    driverId: owner.id,
    role: "owner",
    status: "active",
    lastVtcCheckAt: NOW,
  });
  // The TruckersMP id is remembered once we have seen the player there.
  const saved = await db.driver.findUniqueOrThrow({ where: { id: owner.id } });
  expect(saved.truckersmpId).toBe(tmp.players.get(owner.steamId64)!.id);
});

test("an ordinary member of the VTC cannot claim it", async () => {
  const tmp = fakeTruckersMp();
  const owner = await linkSteam(db, await makeDriver(db));
  const member = await linkSteam(db, await makeDriver(db));
  const vtc = tmp.addVtc("Baltic Lines", owner.steamId64);
  tmp.join(member.steamId64, vtc.id);

  expect((await registrationStatus(db, member, tmp)).status).toBe("not_owner");
  expect(await fails(createCompany(db, member, { vtcId: vtc.id }, tmp))).toBe("FORBIDDEN");
  expect(await db.company.count({ where: { truckersmpVtcId: vtc.id } })).toBe(0);
});

test("someone outside the VTC cannot claim it by sending its id", async () => {
  const tmp = fakeTruckersMp();
  const owner = await linkSteam(db, await makeDriver(db));
  const stranger = await linkSteam(db, await makeDriver(db));
  const vtc = tmp.addVtc("Alpine Cargo", owner.steamId64);
  tmp.leave(stranger.steamId64);
  expect(await fails(createCompany(db, stranger, { vtcId: vtc.id }, tmp))).toBe("FORBIDDEN");

  // Nor the owner of a different VTC: the id sent must be their own VTC's.
  const other = await linkSteam(db, await makeDriver(db));
  tmp.addVtc("Other Hauling", other.steamId64);
  expect(await fails(createCompany(db, other, { vtcId: vtc.id }, tmp))).toBe("CONFLICT");
  expect(await db.company.count({ where: { truckersmpVtcId: vtc.id } })).toBe(0);
});

test("a co-owner role on TruckersMP may register the VTC", async () => {
  const tmp = fakeTruckersMp();
  const owner = await linkSteam(db, await makeDriver(db));
  const coOwner = await linkSteam(db, await makeDriver(db));
  const vtc = tmp.addVtc("Twin Axle", owner.steamId64, { coOwners: [coOwner.steamId64] });
  tmp.join(coOwner.steamId64, vtc.id);
  expect((await registrationStatus(db, coOwner, tmp)).status).toBe("ready");
});

test("every reason a driver can't register has its own status", async () => {
  const tmp = fakeTruckersMp();
  const unlinked = { ...(await makeDriver(db)), steamId64: null, truckersmpId: null };
  expect((await registrationStatus(db, unlinked, tmp)).status).toBe("steam_not_linked");

  const noAccount = await linkSteam(db, await makeDriver(db));
  expect((await registrationStatus(db, noAccount, tmp)).status).toBe("no_truckersmp_account");

  const loner = await linkSteam(db, await makeDriver(db));
  tmp.leave(loner.steamId64);
  expect((await registrationStatus(db, loner, tmp)).status).toBe("not_in_vtc");

  tmp.setOffline(true);
  clearCache();
  expect((await registrationStatus(db, loner, tmp)).status).toBe("unavailable");
  expect(await fails(createCompany(db, loner, { vtcId: 1 }, tmp))).toBe("BAD_GATEWAY");
});

test("a TruckersMP VTC can be registered once", async () => {
  const tmp = fakeTruckersMp();
  const owner = await linkSteam(db, await makeDriver(db));
  const coOwner = await linkSteam(db, await makeDriver(db));
  const vtc = tmp.addVtc("Once Only", owner.steamId64, { coOwners: [coOwner.steamId64] });
  tmp.join(coOwner.steamId64, vtc.id);

  const company = await createCompany(db, owner, { vtcId: vtc.id }, tmp);
  const again = await registrationStatus(db, coOwner, tmp);
  expect(again.status).toBe("already_registered");
  if (again.status === "already_registered") expect(again.company.slug).toBe(company.slug);
  expect(await fails(createCompany(db, coOwner, { vtcId: vtc.id }, tmp))).toBe("CONFLICT");
  expect(await db.company.count({ where: { truckersmpVtcId: vtc.id } })).toBe(1);
});

test("two sign-ups for the same VTC at the same moment make one company", async () => {
  const tmp = fakeTruckersMp();
  const owner = await linkSteam(db, await makeDriver(db));
  const coOwner = await linkSteam(db, await makeDriver(db));
  const vtc = tmp.addVtc("Race Day", owner.steamId64, { coOwners: [coOwner.steamId64] });
  tmp.join(coOwner.steamId64, vtc.id);

  const results = await Promise.allSettled([
    createCompany(db, owner, { vtcId: vtc.id }, tmp),
    createCompany(db, coOwner, { vtcId: vtc.id }, tmp),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const lost = results.find((r) => r.status === "rejected");
  expect(code(lost?.status === "rejected" ? lost.reason : null)).toBe("CONFLICT");
  const companies = await db.company.findMany({
    where: { truckersmpVtcId: vtc.id },
    include: { memberships: true },
  });
  expect(companies).toHaveLength(1);
  // The loser got no membership out of it.
  expect(companies[0]!.memberships).toHaveLength(1);
});

test("a driver who is in a company cannot register another", async () => {
  const tmp = fakeTruckersMp();
  const existing = await makeCompany(db);
  const driver = await linkSteam(db, await makeDriver(db, { companyId: existing.id }));
  const vtc = tmp.addVtc("Second Thoughts", driver.steamId64);

  const status = await registrationStatus(db, driver, tmp);
  expect(status.status).toBe("has_company");
  // Decided without asking TruckersMP at all.
  expect(tmp.calls).toHaveLength(0);
  expect(await fails(createCompany(db, driver, { vtcId: vtc.id }, tmp))).toBe("CONFLICT");
  expect(await db.company.count({ where: { truckersmpVtcId: vtc.id } })).toBe(0);
});

test("two companies with the same name get different addresses", async () => {
  const tmp = fakeTruckersMp();
  const a = await linkSteam(db, await makeDriver(db));
  const b = await linkSteam(db, await makeDriver(db));
  const name = `Same Name ${Math.random().toString(36).slice(2, 8)}`;
  const first = await createCompany(db, a, { vtcId: tmp.addVtc(name, a.steamId64).id }, tmp);
  const second = await createCompany(db, b, { vtcId: tmp.addVtc(name, b.steamId64).id }, tmp);
  expect(second.slug).toBe(`${first.slug}-2`);
});
