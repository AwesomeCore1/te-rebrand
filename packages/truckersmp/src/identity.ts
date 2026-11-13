// Who is who on TruckersMP: a player by SteamID64, a VTC by id, and whether a
// player is a member or the owner of a VTC. This is what lets Tacho trust a
// company sign-up and a membership without asking anyone to prove it by hand.
import { z } from "zod";

import { getOrNull, type RequestOptions, SITE, utcDate } from "./client";

/** A Steam account id: 17 digits. Kept as a string; it does not fit a JS number. */
const STEAM_ID64 = /^\d{17}$/;

// TruckersMP sends SteamID64 both as a number (which JSON.parse rounds) and as
// a string. Only the string (`steamID`) is safe to read.
const PlayerSchema = z.object({
  id: z.number(),
  name: z.string(),
  avatar: z.string().nullish(),
  steamID: z.string().regex(STEAM_ID64),
  banned: z.boolean().nullish(),
  vtc: z
    .object({
      id: z.number(),
      name: z.string().nullish(),
      tag: z.string().nullish(),
      inVTC: z.boolean(),
      memberID: z.number(),
    })
    .nullish(),
});

export type TmpPlayer = {
  /** The TruckersMP user id. */
  id: number;
  name: string;
  steamId64: string;
  avatar: string | null;
  banned: boolean;
  /** The one VTC the player is in (TruckersMP allows one), or null. */
  vtc: { id: number; name: string; tag: string | null; memberId: number } | null;
};

const VtcSchema = z.object({
  id: z.number(),
  name: z.string(),
  owner_id: z.number(),
  owner_username: z.string().nullish(),
  slogan: z.string().nullish(),
  tag: z.string().nullish(),
  logo: z.string().nullish(),
  members_count: z.number().nullish(),
  recruitment: z.string().nullish(),
  verified: z.boolean().nullish(),
});

export type TmpVtc = {
  id: number;
  name: string;
  tag: string | null;
  logo: string | null;
  slogan: string | null;
  /** The TruckersMP user id of the VTC's owner. */
  ownerId: number;
  ownerName: string | null;
  membersCount: number | null;
  /** Verified by TruckersMP itself (their blue tick), not by us. */
  verifiedByTruckersMp: boolean;
  /** The VTC's page on truckersmp.com. */
  url: string;
};

const MemberSchema = z.object({
  id: z.number(),
  user_id: z.number(),
  username: z.string(),
  steamID: z.string().regex(STEAM_ID64),
  roles: z.array(z.object({ name: z.string(), owner: z.boolean().nullish() })).nullish(),
  role: z.string().nullish(),
  is_owner: z.boolean().nullish(),
  joinDate: utcDate.nullish().catch(null),
});

export type TmpVtcMember = {
  /** The id of the membership (not of the player). */
  memberId: number;
  /** The TruckersMP user id. */
  userId: number;
  username: string;
  steamId64: string;
  role: string | null;
  /**
   * True for the VTC's owner and for anyone holding a role TruckersMP marks as
   * an owner role. The public API says nothing else about what a role may do.
   */
  isOwner: boolean;
  joinedAt: Date | null;
};

function normaliseMember(m: z.infer<typeof MemberSchema>): TmpVtcMember {
  return {
    memberId: m.id,
    userId: m.user_id,
    username: m.username,
    steamId64: m.steamID,
    role: m.role || null,
    isOwner: Boolean(m.is_owner) || (m.roles ?? []).some((r) => r.owner === true),
    joinedAt: m.joinDate ?? null,
  };
}

/** Members that don't parse are dropped, and `complete` turns false. */
const MembersSchema = z.object({
  members: z.array(z.unknown()),
  members_count: z.number().nullish(),
});

export function isSteamId64(value: string) {
  return STEAM_ID64.test(value);
}

/**
 * A player by SteamID64 (or TruckersMP id; the endpoint takes both). Null when
 * that Steam account has no TruckersMP account.
 */
export async function player(
  steamId64OrId: string | number,
  options?: RequestOptions,
): Promise<TmpPlayer | null> {
  const id = String(steamId64OrId);
  if (!/^\d{1,20}$/.test(id)) return null;
  const p = await getOrNull(`/player/${id}`, PlayerSchema, options);
  if (!p) return null;
  const inVtc = p.vtc && p.vtc.inVTC && p.vtc.id > 0;
  return {
    id: p.id,
    name: p.name,
    steamId64: p.steamID,
    avatar: p.avatar || null,
    banned: Boolean(p.banned),
    vtc:
      inVtc && p.vtc
        ? {
            id: p.vtc.id,
            name: p.vtc.name ?? "",
            tag: p.vtc.tag || null,
            memberId: p.vtc.memberID,
          }
        : null,
  };
}

/** A VTC by its TruckersMP id. Null when there is none. */
export async function vtc(id: number, options?: RequestOptions): Promise<TmpVtc | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const v = await getOrNull(`/vtc/${id}`, VtcSchema, options);
  if (!v) return null;
  return {
    id: v.id,
    name: v.name,
    tag: v.tag || null,
    logo: v.logo || null,
    slogan: v.slogan || null,
    ownerId: v.owner_id,
    ownerName: v.owner_username || null,
    membersCount: v.members_count ?? null,
    verifiedByTruckersMp: Boolean(v.verified),
    url: `${SITE}/vtc/${v.id}`,
  };
}

/** One member of a VTC, by the member id on the player (`TmpPlayer.vtc.memberId`). */
export async function vtcMember(
  vtcId: number,
  memberId: number,
  options?: RequestOptions,
): Promise<TmpVtcMember | null> {
  const m = await getOrNull(`/vtc/${vtcId}/member/${memberId}`, MemberSchema, options);
  return m ? normaliseMember(m) : null;
}

/**
 * Everyone in a VTC, in one request. `complete` is false when the list is
 * shorter than TruckersMP's own count (a member that didn't parse, or a list
 * that was cut short): then a missing name proves nothing. Null when the VTC
 * does not exist.
 */
export async function vtcMembers(
  vtcId: number,
  options?: RequestOptions,
): Promise<{ members: TmpVtcMember[]; complete: boolean } | null> {
  const raw = await getOrNull(`/vtc/${vtcId}/members`, MembersSchema, options);
  if (!raw) return null;
  const members = raw.members.flatMap((item) => {
    const parsed = MemberSchema.safeParse(item);
    return parsed.success ? [normaliseMember(parsed.data)] : [];
  });
  const count = raw.members_count ?? raw.members.length;
  return { members, complete: members.length > 0 && members.length >= count };
}

export type VtcStanding =
  /** The Steam account has no TruckersMP account. */
  | { status: "no_player" }
  /** On TruckersMP, but not in a VTC. */
  | { status: "no_vtc"; player: TmpPlayer }
  /** In a VTC. `owner`: owns it, or holds an owner role there. */
  | { status: "member" | "owner"; player: TmpPlayer; vtc: TmpVtc };

/**
 * The VTC a Steam account is in on TruckersMP, and whether it runs it. This is
 * the check behind "register your VTC": only `owner` may claim a company.
 *
 * At most three requests: the player, their VTC, and (only when they are not
 * the VTC's listed owner) their member record, for owner roles.
 */
export async function vtcStanding(
  steamId64: string,
  options?: RequestOptions,
): Promise<VtcStanding> {
  if (!isSteamId64(steamId64)) return { status: "no_player" };
  const p = await player(steamId64, options);
  if (!p) return { status: "no_player" };
  if (!p.vtc) return { status: "no_vtc", player: p };
  const v = await vtc(p.vtc.id, options);
  // The player says they're in a VTC that TruckersMP no longer has.
  if (!v) return { status: "no_vtc", player: p };
  if (v.ownerId === p.id) return { status: "owner", player: p, vtc: v };
  const member = await vtcMember(v.id, p.vtc.memberId, options);
  const owns = member !== null && member.userId === p.id && member.isOwner;
  return { status: owns ? "owner" : "member", player: p, vtc: v };
}

/**
 * Whether a Steam account is in this VTC on TruckersMP right now. One request.
 * `player` is null when the Steam account has no TruckersMP account.
 */
export async function vtcMembership(
  steamId64: string,
  vtcId: number,
  options?: RequestOptions,
): Promise<{ member: boolean; player: TmpPlayer | null }> {
  const p = isSteamId64(steamId64) ? await player(steamId64, options) : null;
  return { member: p?.vtc?.id === vtcId, player: p };
}
