// Registering a company. A company on Tacho is a VTC on TruckersMP, claimed by
// the person who runs it there: we ask TruckersMP, so nobody can claim someone
// else's VTC. Companies that are not on TruckersMP can't sign up yet (an open
// question in docs/PLAN.md).
import type { Database } from "@te-rebrand/db";
import { TruckersMpError, vtcStanding } from "@te-rebrand/truckersmp";
import { TRPCError } from "@trpc/server";

import {
  activeMembership,
  isUniqueViolation,
  joinCompany,
  rememberTruckersmpId,
} from "./memberships";

/** How old a TruckersMP answer may be when it decides something. */
export const DECISION_MAX_AGE_MS = 60_000;

/** Paths under /vtc/ that are pages of our own, so no company may have them as its slug. */
const RESERVED_SLUGS = new Set(["new", "admin", "edit", "settings"]);

/** "Nordic Haulage ™" -> "nordic-haulage". Empty when the name has no Latin letters or digits. */
export function slugify(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
}

/** A slug nobody has yet: the name, then name-2, name-3, and so on. */
export async function freeSlug(
  taken: (slug: string) => Promise<boolean>,
  name: string,
  vtcId: number,
) {
  let base = slugify(name);
  if (base.length < 2) base = `vtc-${vtcId}`;
  if (RESERVED_SLUGS.has(base)) base = `${base}-vtc`;
  for (let n = 1; n < 50; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (!(await taken(slug))) return slug;
  }
  return `${base}-${vtcId}`;
}

type DriverRow = {
  id: string;
  displayName: string;
  steamId64: string | null;
  truckersmpId: number | null;
};
type VtcSummary = {
  id: number;
  name: string;
  tag: string | null;
  logo: string | null;
  membersCount: number | null;
  url: string;
};
type CompanyLink = { name: string; slug: string };

/** Where a driver stands on registering a company. Every case has its own screen. */
export type RegistrationStatus =
  | { status: "has_company"; company: CompanyLink; role: "owner" | "manager" | "driver" }
  | { status: "steam_not_linked" }
  | { status: "unavailable" }
  | { status: "no_truckersmp_account" }
  | { status: "not_in_vtc"; playerName: string }
  /** Their VTC is on Tacho already; they can apply to it instead. */
  | { status: "already_registered"; vtc: VtcSummary; company: CompanyLink }
  /** In a VTC, but TruckersMP doesn't say they run it. */
  | { status: "not_owner"; vtc: VtcSummary; ownerName: string | null }
  | { status: "ready"; vtc: VtcSummary; playerName: string };

type Deps = { fetchImpl?: typeof fetch; maxAgeMs?: number; now?: Date };

/**
 * Checks, through TruckersMP, which VTC this driver could register. A driver
 * doesn't type a VTC id: TruckersMP allows one VTC per player, so the VTC they
 * are in is the only one they could own.
 */
export async function registrationStatus(
  db: Database,
  driver: DriverRow,
  { fetchImpl, maxAgeMs }: Deps = {},
): Promise<RegistrationStatus> {
  const current = await activeMembership(db, driver.id);
  if (current) {
    return {
      status: "has_company",
      company: { name: current.company.name, slug: current.company.slug },
      role: current.role,
    };
  }
  if (!driver.steamId64) return { status: "steam_not_linked" };

  let standing;
  try {
    standing = await vtcStanding(driver.steamId64, { fetchImpl, maxAgeMs });
  } catch (e) {
    if (e instanceof TruckersMpError) return { status: "unavailable" };
    throw e;
  }
  await rememberTruckersmpId(
    db,
    driver,
    standing.status === "no_player" ? null : standing.player.id,
  );
  if (standing.status === "no_player") return { status: "no_truckersmp_account" };
  if (standing.status === "no_vtc") {
    return { status: "not_in_vtc", playerName: standing.player.name };
  }

  const { vtc, player } = standing;
  const summary: VtcSummary = {
    id: vtc.id,
    name: vtc.name,
    tag: vtc.tag,
    logo: vtc.logo,
    membersCount: vtc.membersCount,
    url: vtc.url,
  };
  const registered = await db.company.findUnique({
    where: { truckersmpVtcId: vtc.id },
    select: { name: true, slug: true },
  });
  if (registered) return { status: "already_registered", vtc: summary, company: registered };
  if (standing.status !== "owner") {
    return { status: "not_owner", vtc: summary, ownerName: vtc.ownerName };
  }
  return { status: "ready", vtc: summary, playerName: player.name };
}

const REFUSALS: Record<Exclude<RegistrationStatus["status"], "ready">, string> = {
  has_company: "You're already in a company. Leave it before you register another.",
  steam_not_linked: "Link Steam first, so we can find you on TruckersMP.",
  unavailable: "Couldn't reach TruckersMP. Try again in a minute. Nothing was created.",
  no_truckersmp_account: "Your Steam account has no TruckersMP account.",
  not_in_vtc: "You're not in a VTC on TruckersMP.",
  already_registered: "That VTC is already on Tacho.",
  not_owner: "Only the owner of the VTC on TruckersMP can register it.",
};

/**
 * Creates the company and makes the driver its owner. `vtcId` is the VTC the
 * driver was shown; TruckersMP is asked again here, and the two must agree.
 */
export async function createCompany(
  db: Database,
  driver: DriverRow,
  input: { vtcId: number },
  { fetchImpl, maxAgeMs = DECISION_MAX_AGE_MS, now = new Date() }: Deps = {},
) {
  const check = await registrationStatus(db, driver, { fetchImpl, maxAgeMs });
  if (check.status !== "ready") {
    throw new TRPCError({
      code:
        check.status === "unavailable"
          ? "BAD_GATEWAY"
          : check.status === "has_company" || check.status === "already_registered"
            ? "CONFLICT"
            : "FORBIDDEN",
      message: REFUSALS[check.status],
    });
  }
  const { vtc } = check;
  if (vtc.id !== input.vtcId) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "Your VTC on TruckersMP changed since this page loaded. Check again.",
    });
  }

  try {
    return await db.$transaction(async (tx) => {
      const slug = await freeSlug(
        async (s) => (await tx.company.count({ where: { slug: s } })) > 0,
        vtc.name,
        vtc.id,
      );
      const company = await tx.company.create({
        data: {
          name: vtc.name.trim().slice(0, 60) || `VTC ${vtc.id}`,
          slug,
          tag: vtc.tag,
          logoUrl: vtc.logo,
          truckersmpVtcId: vtc.id,
          // Verified: TruckersMP confirmed this driver runs the VTC.
          verifiedAt: now,
        },
        select: { id: true, name: true, slug: true },
      });
      await joinCompany(
        tx,
        { companyId: company.id, driverId: driver.id, role: "owner", now, checkedVtc: true },
        () => REFUSALS.has_company,
      );
      return company;
    });
  } catch (e) {
    // Two sign-ups for the same VTC (or the same slug) at the same moment.
    if (isUniqueViolation(e)) {
      throw new TRPCError({ code: "CONFLICT", message: REFUSALS.already_registered });
    }
    throw e;
  }
}
