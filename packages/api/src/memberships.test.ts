// Members, roles and keeping companies apart, tested through the real tRPC
// router so the `companyProcedure` check is part of what is tested.
import { expect, test } from "bun:test";

import { TRPCError } from "@trpc/server";

import { updateCompanySettings } from "./company-settings";
import { leaveBlock, removalBlock } from "./membership-rules";
import { appRouter } from "./routers/index";
import { makeCompany, makeDriver, makeJob, testDb } from "./test-db";
import { linkSteam } from "./test-truckersmp";

const db = await testDb();

const code = (e: unknown) => (e instanceof TRPCError ? e.code : `not a TRPCError: ${String(e)}`);
const fails = (p: Promise<unknown>) => p.then(() => "did not fail", code);
const membershipOf = (driverId: string, companyId: string) =>
  db.membership.findFirstOrThrow({ where: { driverId, companyId } });

/** A company with an owner, a manager and two drivers, each with a tRPC caller. */
async function crew() {
  const company = await makeCompany(db);
  const make = async (role: "owner" | "manager" | "driver") => {
    const driver = await makeDriver(db, { companyId: company.id, role });
    return {
      ...driver,
      api: appRouter.createCaller(driver.ctx),
      membership: await membershipOf(driver.id, company.id),
    };
  };
  return {
    company,
    owner: await make("owner"),
    manager: await make("manager"),
    driver: await make("driver"),
    driver2: await make("driver"),
  };
}

test("rules: who may remove whom", () => {
  expect(removalBlock("manager", "driver", false)).toBeNull();
  expect(removalBlock("owner", "driver", false)).toBeNull();
  expect(removalBlock("owner", "manager", false)).toBeNull();
  expect(removalBlock("manager", "manager", false)).toContain("Only the owner");
  expect(removalBlock("manager", "owner", false)).toContain("owner can't be removed");
  expect(removalBlock("owner", "owner", true)).toContain("owner can't be removed");
  expect(removalBlock("manager", "manager", true)).toContain("Leave company");
  expect(removalBlock("driver", "driver", false)).not.toBeNull();
  expect(leaveBlock("owner")).not.toBeNull();
  expect(leaveBlock("manager")).toBeNull();
  expect(leaveBlock("driver")).toBeNull();
});

test("members list: role, joined date and distance driven for this company", async () => {
  const { company, owner, driver } = await crew();
  const elsewhere = await makeCompany(db);
  await makeJob(db, { driverId: driver.id, companyId: company.id, drivenKm: 1200 });
  await makeJob(db, { driverId: driver.id, companyId: company.id, drivenKm: 300 });
  // None of these count: cancelled, flagged, another company, solo.
  await makeJob(db, {
    driverId: driver.id,
    companyId: company.id,
    drivenKm: 999,
    status: "cancelled",
  });
  await makeJob(db, {
    driverId: driver.id,
    companyId: company.id,
    drivenKm: 999,
    status: "flagged",
  });
  await makeJob(db, { driverId: driver.id, companyId: elsewhere.id, drivenKm: 999 });
  await makeJob(db, { driverId: driver.id, companyId: null, drivenKm: 999 });

  const members = await owner.api.company.members({ companyId: company.id });
  expect(members).toHaveLength(4);
  expect(members.map((m) => m.role)).toEqual(["owner", "manager", "driver", "driver"]);
  const row = members.find((m) => m.driver.id === driver.id)!;
  expect(row).toMatchObject({ kmInCompany: 1500, jobsInCompany: 2, you: false });
  expect(row.joinedAt).toBeInstanceOf(Date);
  expect(members.find((m) => m.you)?.driver.id).toBe(owner.id);
});

test("roles: only the owner changes them, and the owner can't be demoted", async () => {
  const { company, owner, manager, driver } = await crew();
  const companyId = company.id;
  const promote = { companyId, membershipId: driver.membership.id, role: "manager" as const };

  expect(await fails(manager.api.company.setMemberRole(promote))).toBe("FORBIDDEN");
  expect(await fails(driver.api.company.setMemberRole(promote))).toBe("FORBIDDEN");
  await owner.api.company.setMemberRole(promote);
  expect((await membershipOf(driver.id, companyId)).role).toBe("manager");

  // Nobody can demote the owner, not even the owner.
  const demoteOwner = { companyId, membershipId: owner.membership.id, role: "driver" as const };
  expect(await fails(owner.api.company.setMemberRole(demoteOwner))).toBe("NOT_FOUND");
  expect((await membershipOf(owner.id, companyId)).role).toBe("owner");
  // "owner" is not a role that can be handed out.
  const makeOwner = { ...promote, role: "owner" } as unknown as typeof promote;
  expect(await fails(owner.api.company.setMemberRole(makeOwner))).toBe("BAD_REQUEST");
});

test("remove: a manager removes a driver; the row is kept as history", async () => {
  const { company, manager, driver } = await crew();
  await manager.api.memberships.remove({
    companyId: company.id,
    membershipId: driver.membership.id,
  });
  const row = await membershipOf(driver.id, company.id);
  expect(row.status).toBe("removed");
  expect(row.leftAt).toBeInstanceOf(Date);
  // Gone means out: the removed driver no longer gets in.
  expect(await fails(driver.api.company.members({ companyId: company.id }))).toBe("FORBIDDEN");
  // And can't be removed twice.
  expect(
    await fails(
      manager.api.memberships.remove({
        companyId: company.id,
        membershipId: driver.membership.id,
      }),
    ),
  ).toBe("NOT_FOUND");
});

test("remove: nobody removes the owner, a manager can't remove a manager, drivers remove nobody", async () => {
  const { company, owner, manager, driver, driver2 } = await crew();
  const companyId = company.id;
  const remove = (who: typeof owner, target: typeof owner) =>
    fails(who.api.memberships.remove({ companyId, membershipId: target.membership.id }));

  expect(await remove(manager, owner)).toBe("FORBIDDEN");
  expect(await remove(owner, owner)).toBe("FORBIDDEN");
  expect(await remove(manager, manager)).toBe("FORBIDDEN");
  expect(await remove(driver, driver2)).toBe("FORBIDDEN");

  const manager2 = await makeDriver(db, { companyId, role: "manager" });
  const manager2Row = await membershipOf(manager2.id, companyId);
  expect(
    await fails(manager.api.memberships.remove({ companyId, membershipId: manager2Row.id })),
  ).toBe("FORBIDDEN");
  // The owner can.
  await owner.api.memberships.remove({ companyId, membershipId: manager2Row.id });

  const statuses = await db.membership.groupBy({
    by: ["status"],
    where: { companyId },
    _count: true,
  });
  expect(Object.fromEntries(statuses.map((s) => [s.status, s._count]))).toEqual({
    active: 4,
    removed: 1,
  });
});

test("leave: a member leaves; the owner can't", async () => {
  const { company, owner, manager, driver } = await crew();
  const companyId = company.id;
  await driver.api.memberships.leave({ companyId });
  await manager.api.memberships.leave({ companyId });
  expect(await membershipOf(driver.id, companyId)).toMatchObject({ status: "left" });
  expect((await membershipOf(manager.id, companyId)).leftAt).toBeInstanceOf(Date);
  expect(await fails(owner.api.memberships.leave({ companyId }))).toBe("FORBIDDEN");
  expect((await membershipOf(owner.id, companyId)).status).toBe("active");
  // Having left, they are free to join another company.
  expect(await db.membership.count({ where: { driverId: driver.id, status: "active" } })).toBe(0);
});

test("a manager of one company cannot read or change another company", async () => {
  const a = await crew();
  const b = await crew();
  await updateCompanySettings(db, b.company.id, (s) => ({
    ...s,
    recruitment: { open: true, questions: ["Why us?"] },
  }));
  const applicant = await linkSteam(db, await makeDriver(db));
  const application = await appRouter
    .createCaller(applicant.ctx)
    .applications.submit({ companyId: b.company.id, answers: ["Because."] });

  const intruder = a.manager.api;
  const companyId = b.company.id;
  const target = { companyId, membershipId: b.driver.membership.id };
  const app = { companyId, applicationId: application.id };

  // Asking for company B directly: stopped by companyProcedure, every time.
  const direct = [
    intruder.company.members({ companyId }),
    intruder.company.flaggedJobs({ companyId }),
    intruder.company.setMemberRole({ ...target, role: "manager" }),
    intruder.memberships.remove(target),
    intruder.memberships.leave({ companyId }),
    intruder.applications.pending({ companyId }),
    intruder.applications.accept(app),
    intruder.applications.reject(app),
    intruder.applications.form({ companyId }),
    intruder.applications.setForm({ companyId, open: false, questions: [] }),
  ];
  expect(await Promise.all(direct.map(fails))).toEqual(direct.map(() => "FORBIDDEN"));
  // A company that doesn't exist gives the same answer, so ids can't be probed.
  expect(await fails(intruder.company.members({ companyId: "no-such-company" }))).toBe("FORBIDDEN");

  // Asking through their own company, with ids that belong to B: not found.
  const own = a.company.id;
  expect(
    await fails(a.owner.api.company.setMemberRole({ ...target, companyId: own, role: "manager" })),
  ).toBe("NOT_FOUND");
  expect(await fails(intruder.memberships.remove({ ...target, companyId: own }))).toBe("NOT_FOUND");
  expect(await fails(intruder.applications.accept({ ...app, companyId: own }))).toBe("NOT_FOUND");
  expect(await fails(intruder.applications.reject({ ...app, companyId: own }))).toBe("NOT_FOUND");

  // Nothing in B moved.
  expect(await membershipOf(b.driver.id, companyId)).toMatchObject({
    status: "active",
    role: "driver",
  });
  expect((await db.application.findUniqueOrThrow({ where: { id: application.id } })).status).toBe(
    "pending",
  );
  expect((await b.manager.api.applications.form({ companyId })).open).toBe(true);
  // And B's own manager sees the application, with its answers.
  const pending = await b.manager.api.applications.pending({ companyId });
  expect(pending).toHaveLength(1);
  expect(pending[0]).toMatchObject({
    id: application.id,
    answers: [{ question: "Why us?", answer: "Because." }],
    driver: { id: applicant.id, steamLinked: true },
  });
});

test("drivers don't get the manager screens of their own company", async () => {
  const { company, driver } = await crew();
  const companyId = company.id;
  const tries = [
    driver.api.applications.pending({ companyId }),
    driver.api.applications.form({ companyId }),
    driver.api.applications.setForm({ companyId, open: true, questions: [] }),
    driver.api.applications.accept({ companyId, applicationId: "x" }),
    driver.api.company.flaggedJobs({ companyId }),
  ];
  expect(await Promise.all(tries.map(fails))).toEqual(tries.map(() => "FORBIDDEN"));
  // The member list is theirs to see.
  expect(await driver.api.company.members({ companyId })).toHaveLength(4);
});

test("logged out: nothing behind a company check, the public page still works", async () => {
  const { company } = await crew();
  const anonymous = appRouter.createCaller({ db, session: null });
  expect(await fails(anonymous.company.members({ companyId: company.id }))).toBe("UNAUTHORIZED");
  expect(await fails(anonymous.applications.submit({ companyId: company.id, answers: [] }))).toBe(
    "UNAUTHORIZED",
  );
  expect(await fails(anonymous.company.registration())).toBe("UNAUTHORIZED");
  expect(await anonymous.company.viewer({ slug: company.slug })).toEqual({ signedIn: false });
  const page = await anonymous.company.page({ slug: company.slug });
  expect(page.stats.members).toBe(4);
  expect(await fails(anonymous.company.page({ slug: "no-such-company" }))).toBe("NOT_FOUND");
});

test("public page: totals from delivered jobs only, and the recruitment form", async () => {
  const { company, owner, manager, driver } = await crew();
  const lastYear = new Date(Date.now() - 400 * 86_400_000);
  await makeJob(db, { driverId: driver.id, companyId: company.id, drivenKm: 1000 });
  await makeJob(db, {
    driverId: manager.id,
    companyId: company.id,
    drivenKm: 500,
    finishedAt: lastYear,
  });
  await makeJob(db, {
    driverId: driver.id,
    companyId: company.id,
    drivenKm: 7777,
    status: "cancelled",
  });
  await makeJob(db, {
    driverId: driver.id,
    companyId: company.id,
    drivenKm: 7777,
    status: "flagged",
  });
  await owner.api.applications.setForm({
    companyId: company.id,
    open: true,
    questions: ["  Why us?  ", "Which games?"],
  });
  await updateCompanySettings(db, company.id, (s) => ({ ...s, about: "**Nordic** by road." }));

  const page = await appRouter.createCaller({ db, session: null }).company.page({
    slug: company.slug,
  });
  expect(page.stats).toEqual({
    members: 4,
    monthKm: 1000,
    monthJobs: 1,
    allTimeKm: 1500,
    allTimeJobs: 2,
  });
  expect(page.recruitment).toEqual({ open: true, questions: ["Why us?", "Which games?"] });
  // Saving the form left the rest of the settings alone.
  expect(page.about).toBe("**Nordic** by road.");
  expect(page).not.toHaveProperty("settings");
});

test("viewer: member here, member elsewhere, applicant, and free to apply", async () => {
  const { company, driver } = await crew();
  const other = await crew();
  const slug = company.slug;
  await updateCompanySettings(db, company.id, (s) => ({
    ...s,
    recruitment: { open: true, questions: [] },
  }));

  const here = await driver.api.company.viewer({ slug });
  expect(here).toMatchObject({ signedIn: true, membership: { here: true, role: "driver" } });
  const elsewhere = await other.driver.api.company.viewer({ slug });
  expect(elsewhere).toMatchObject({
    membership: { here: false, company: { slug: other.company.slug } },
    application: null,
  });

  const free = await makeDriver(db);
  const freeApi = appRouter.createCaller(free.ctx);
  expect(await freeApi.company.viewer({ slug })).toMatchObject({
    signedIn: true,
    steamLinked: false,
    membership: null,
    application: null,
    unit: "km",
  });
  const linked = await linkSteam(db, await makeDriver(db));
  const linkedApi = appRouter.createCaller(linked.ctx);
  const sent = await linkedApi.applications.submit({ companyId: company.id, answers: [] });
  expect(await linkedApi.company.viewer({ slug })).toMatchObject({
    steamLinked: true,
    application: { id: sent.id },
  });
  await linkedApi.applications.withdraw({ applicationId: sent.id });
  expect((await linkedApi.company.viewer({ slug })).signedIn).toBe(true);
  expect(await linkedApi.company.viewer({ slug })).toMatchObject({ application: null });
});
