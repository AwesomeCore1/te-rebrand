import { beforeEach, expect, test } from "bun:test";

import type { Database } from "@te-rebrand/db";
import { clearCache } from "@te-rebrand/truckersmp";
import { TRPCError } from "@trpc/server";

import {
  acceptApplication,
  parseAnswers,
  rejectApplication,
  submitApplication,
  withdrawApplication,
} from "./applications";
import { updateCompanySettings } from "./company-settings";
import { makeCompany, makeDriver, testDb } from "./test-db";
import { fakeTruckersMp, linkSteam } from "./test-truckersmp";

const db = await testDb();
beforeEach(clearCache);

const NOW = new Date("2026-11-13T10:00:00Z");
const QUESTIONS = ["Why us?", "Which games do you drive?"];
const ANSWERS = ["I like fjords.", "ETS2 mostly"];
const code = (e: unknown) => (e instanceof TRPCError ? e.code : `not a TRPCError: ${String(e)}`);
const fails = (p: Promise<unknown>) => p.then(() => "did not fail", code);
const message = (p: Promise<unknown>) =>
  p.then(
    () => "did not fail",
    (e: unknown) => (e instanceof Error ? e.message : String(e)),
  );

/** A company with an open recruitment form. With `tmp`, it has a VTC on (the pretend) TruckersMP. */
async function recruitingCompany(database: Database, tmp?: ReturnType<typeof fakeTruckersMp>) {
  const company = await makeCompany(database);
  await updateCompanySettings(database, company.id, (s) => ({
    ...s,
    recruitment: { open: true, questions: QUESTIONS },
  }));
  if (!tmp) return { ...company, vtc: null };
  const owner = await linkSteam(database, await makeDriver(database, { companyId: company.id }));
  const vtc = tmp.addVtc(company.name, owner.steamId64);
  await database.company.update({
    where: { id: company.id },
    data: { truckersmpVtcId: vtc.id, verifiedAt: NOW },
  });
  return { ...company, vtc };
}
const statusOf = (id: string) =>
  db.application.findUniqueOrThrow({ where: { id } }).then((a) => a.status);
const activeIn = (driverId: string) =>
  db.membership.findMany({ where: { driverId, status: "active" } });

test("apply: answers are saved with their questions, in order, as pending", async () => {
  const company = await recruitingCompany(db);
  const driver = await linkSteam(db, await makeDriver(db));
  const { id } = await submitApplication(
    db,
    driver,
    { companyId: company.id, answers: ["  I like fjords.  ", "ETS2 mostly"] },
    NOW,
  );
  const row = await db.application.findUniqueOrThrow({ where: { id } });
  expect(row).toMatchObject({ companyId: company.id, driverId: driver.id, status: "pending" });
  expect(parseAnswers(row.answers)).toEqual([
    { question: "Why us?", answer: "I like fjords." },
    { question: "Which games do you drive?", answer: "ETS2 mostly" },
  ]);
  expect(parseAnswers({ old: "shape" })).toEqual([]);
});

test("apply: refused when recruitment is closed, Steam isn't linked, or answers are missing", async () => {
  const closed = await makeCompany(db);
  const open = await recruitingCompany(db);
  const driver = await linkSteam(db, await makeDriver(db));
  const input = (companyId: string, answers = ANSWERS) => ({ companyId, answers });

  expect(await fails(submitApplication(db, driver, input(closed.id, [])))).toBe("FORBIDDEN");
  expect(await fails(submitApplication(db, driver, input("no-such-company")))).toBe("NOT_FOUND");
  const unlinked = { ...(await makeDriver(db)), steamId64: null };
  expect(await fails(submitApplication(db, unlinked, input(open.id)))).toBe("PRECONDITION_FAILED");
  expect(await fails(submitApplication(db, driver, input(open.id, ["only one"])))).toBe(
    "BAD_REQUEST",
  );
  expect(await fails(submitApplication(db, driver, input(open.id, ["fine", "   "])))).toBe(
    "BAD_REQUEST",
  );
  expect(await db.application.count({ where: { driverId: driver.id } })).toBe(0);
});

test("apply: once per company while pending, and not while in a company", async () => {
  const company = await recruitingCompany(db);
  const other = await recruitingCompany(db);
  const driver = await linkSteam(db, await makeDriver(db));
  const input = { companyId: company.id, answers: ANSWERS };

  const first = await submitApplication(db, driver, input);
  expect(await fails(submitApplication(db, driver, input))).toBe("CONFLICT");
  // A second company is fine: they can only end up in one.
  await submitApplication(db, driver, { companyId: other.id, answers: ANSWERS });

  // Withdrawn, they may apply again.
  await withdrawApplication(db, driver, first.id, NOW);
  expect(await statusOf(first.id)).toBe("withdrawn");
  expect(await fails(withdrawApplication(db, driver, first.id))).toBe("NOT_FOUND");
  await submitApplication(db, driver, input);

  const member = await linkSteam(db, await makeDriver(db, { companyId: other.id }));
  expect(await fails(submitApplication(db, member, input))).toBe("CONFLICT");
  expect(await message(submitApplication(db, member, input))).toContain("Leave it before");
});

test("apply: two sends at once make one application", async () => {
  const company = await recruitingCompany(db);
  const driver = await linkSteam(db, await makeDriver(db));
  const input = { companyId: company.id, answers: ANSWERS };
  const results = await Promise.allSettled([
    submitApplication(db, driver, input),
    submitApplication(db, driver, input),
    submitApplication(db, driver, input),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await db.application.count({ where: { driverId: driver.id } })).toBe(1);
});

test("withdraw: only your own application", async () => {
  const company = await recruitingCompany(db);
  const driver = await linkSteam(db, await makeDriver(db));
  const someoneElse = await makeDriver(db);
  const { id } = await submitApplication(db, driver, { companyId: company.id, answers: ANSWERS });
  expect(await fails(withdrawApplication(db, someoneElse, id))).toBe("NOT_FOUND");
  expect(await statusOf(id)).toBe("pending");
});

test("accept: a member of the VTC on TruckersMP becomes an active driver", async () => {
  const tmp = fakeTruckersMp();
  const company = await recruitingCompany(db, tmp);
  const driver = await linkSteam(db, await makeDriver(db));
  tmp.join(driver.steamId64, company.vtc!.id);
  const { id } = await submitApplication(db, driver, { companyId: company.id, answers: ANSWERS });

  await acceptApplication(db, { companyId: company.id, applicationId: id }, { ...tmp, now: NOW });
  expect(await db.application.findUniqueOrThrow({ where: { id } })).toMatchObject({
    status: "accepted",
    decidedAt: NOW,
  });
  const memberships = await activeIn(driver.id);
  expect(memberships).toHaveLength(1);
  expect(memberships[0]).toMatchObject({
    companyId: company.id,
    role: "driver",
    joinedAt: NOW,
    // The join itself counts as the first TruckersMP check.
    lastVtcCheckAt: NOW,
  });
  const saved = await db.driver.findUniqueOrThrow({ where: { id: driver.id } });
  expect(saved.truckersmpId).toBe(tmp.players.get(driver.steamId64)!.id);
  // Decided applications can't be decided again.
  expect(
    await fails(acceptApplication(db, { companyId: company.id, applicationId: id }, tmp)),
  ).toBe("NOT_FOUND");
  expect(await fails(rejectApplication(db, { companyId: company.id, applicationId: id }))).toBe(
    "NOT_FOUND",
  );
});

test("accept: refused while the applicant is not in the VTC on TruckersMP", async () => {
  const tmp = fakeTruckersMp();
  const company = await recruitingCompany(db, tmp);
  const input = (applicationId: string) => ({ companyId: company.id, applicationId });

  // No TruckersMP account at all.
  const stranger = await linkSteam(db, await makeDriver(db));
  const a = await submitApplication(db, stranger, { companyId: company.id, answers: ANSWERS });
  expect(await fails(acceptApplication(db, input(a.id), tmp))).toBe("PRECONDITION_FAILED");

  // On TruckersMP, in no VTC; then in a different VTC.
  const loner = await linkSteam(db, await makeDriver(db));
  tmp.leave(loner.steamId64);
  const b = await submitApplication(db, loner, { companyId: company.id, answers: ANSWERS });
  expect(await fails(acceptApplication(db, input(b.id), tmp))).toBe("PRECONDITION_FAILED");
  tmp.join(loner.steamId64, tmp.addVtc("Somewhere Else", stranger.steamId64).id);
  expect(await message(acceptApplication(db, input(b.id), tmp))).toContain("on TruckersMP yet");

  expect(await statusOf(a.id)).toBe("pending");
  expect(await statusOf(b.id)).toBe("pending");
  expect(await activeIn(loner.id)).toHaveLength(0);

  // They join the VTC on TruckersMP; a minute later the same click works.
  tmp.join(loner.steamId64, company.vtc!.id);
  clearCache();
  await acceptApplication(db, input(b.id), tmp);
  expect(await activeIn(loner.id)).toHaveLength(1);
});

test("accept: nothing changes when TruckersMP can't be reached", async () => {
  const tmp = fakeTruckersMp();
  const company = await recruitingCompany(db, tmp);
  const driver = await linkSteam(db, await makeDriver(db));
  tmp.join(driver.steamId64, company.vtc!.id);
  const { id } = await submitApplication(db, driver, { companyId: company.id, answers: ANSWERS });

  tmp.setOffline(true);
  expect(
    await fails(acceptApplication(db, { companyId: company.id, applicationId: id }, tmp)),
  ).toBe("BAD_GATEWAY");
  tmp.setOffline(false);
  tmp.broken.set(`/player/${driver.steamId64}`, 429);
  expect(
    await fails(acceptApplication(db, { companyId: company.id, applicationId: id }, tmp)),
  ).toBe("BAD_GATEWAY");
  expect(await statusOf(id)).toBe("pending");
  expect(await activeIn(driver.id)).toHaveLength(0);
});

test("accept: a driver never ends up in two companies", async () => {
  const tmp = fakeTruckersMp();
  const first = await recruitingCompany(db, tmp);
  const second = await recruitingCompany(db);
  const driver = await linkSteam(db, await makeDriver(db));
  tmp.join(driver.steamId64, first.vtc!.id);
  const a = await submitApplication(db, driver, { companyId: first.id, answers: ANSWERS });
  const b = await submitApplication(db, driver, { companyId: second.id, answers: ANSWERS });

  // Both managers click Accept at the same moment.
  const results = await Promise.allSettled([
    acceptApplication(db, { companyId: first.id, applicationId: a.id }, tmp),
    acceptApplication(db, { companyId: second.id, applicationId: b.id }, tmp),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect(await activeIn(driver.id)).toHaveLength(1);
  // The other application is closed, not left hanging.
  const statuses = [await statusOf(a.id), await statusOf(b.id)].sort();
  expect(statuses).toEqual(["accepted", "withdrawn"]);
});

test("accept: refused when the applicant joined another company in the meantime", async () => {
  const company = await recruitingCompany(db);
  const other = await makeCompany(db);
  const driver = await linkSteam(db, await makeDriver(db));
  const { id } = await submitApplication(db, driver, { companyId: company.id, answers: ANSWERS });
  await db.membership.create({ data: { companyId: other.id, driverId: driver.id } });

  const input = { companyId: company.id, applicationId: id };
  expect(await fails(acceptApplication(db, input))).toBe("CONFLICT");
  expect(await message(acceptApplication(db, input))).toContain("is already in");
  expect(await statusOf(id)).toBe("pending");
  expect(await activeIn(driver.id)).toHaveLength(1);
});

test("accept: a company with no TruckersMP VTC has nothing to check against", async () => {
  const tmp = fakeTruckersMp();
  const company = await recruitingCompany(db);
  const driver = await linkSteam(db, await makeDriver(db));
  const { id } = await submitApplication(db, driver, { companyId: company.id, answers: ANSWERS });
  await acceptApplication(db, { companyId: company.id, applicationId: id }, tmp);
  expect(tmp.calls).toHaveLength(0);
  const [membership] = await activeIn(driver.id);
  expect(membership).toMatchObject({ companyId: company.id, lastVtcCheckAt: null });
});

test("reject: closes the application and creates no membership", async () => {
  const company = await recruitingCompany(db);
  const driver = await linkSteam(db, await makeDriver(db));
  const { id } = await submitApplication(db, driver, { companyId: company.id, answers: ANSWERS });
  await rejectApplication(db, { companyId: company.id, applicationId: id }, NOW);
  expect(await db.application.findUniqueOrThrow({ where: { id } })).toMatchObject({
    status: "rejected",
    decidedAt: NOW,
  });
  expect(await activeIn(driver.id)).toHaveLength(0);
  // Rejected is not forever: they may apply again.
  await submitApplication(db, driver, { companyId: company.id, answers: ANSWERS });
});

test("an application can only be decided through its own company", async () => {
  const company = await recruitingCompany(db);
  const other = await makeCompany(db);
  const driver = await linkSteam(db, await makeDriver(db));
  const { id } = await submitApplication(db, driver, { companyId: company.id, answers: ANSWERS });
  const viaOther = { companyId: other.id, applicationId: id };
  expect(await fails(acceptApplication(db, viaOther))).toBe("NOT_FOUND");
  expect(await fails(rejectApplication(db, viaOther))).toBe("NOT_FOUND");
  expect(await statusOf(id)).toBe("pending");
});
