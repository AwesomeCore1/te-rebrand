// Steam OpenID 2.0 (https://steamcommunity.com/dev): proves the driver owns a
// Steam account and gives us its SteamID64. We never see a Steam password.
// Server-only.

const STEAM_LOGIN = "https://steamcommunity.com/openid/login";
const OPENID_NS = "http://specs.openid.net/auth/2.0";
const IDENTIFIER_SELECT = "http://specs.openid.net/auth/2.0/identifier_select";
const CLAIMED_ID = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/;

export const STEAM_STATE_COOKIE = "te_steam_state";
/** The page to go back to after linking, checked with `safeReturnPath` when set and when read. */
export const STEAM_RETURN_COOKIE = "te_steam_return";

export function steamLoginUrl(baseUrl: string, state: string): string {
  const returnTo = new URL("/api/steam/callback", baseUrl);
  returnTo.searchParams.set("state", state);
  const params = new URLSearchParams({
    "openid.ns": OPENID_NS,
    "openid.mode": "checkid_setup",
    "openid.return_to": returnTo.toString(),
    "openid.realm": new URL(baseUrl).origin,
    "openid.identity": IDENTIFIER_SELECT,
    "openid.claimed_id": IDENTIFIER_SELECT,
  });
  return `${STEAM_LOGIN}?${params}`;
}

/**
 * Checks the assertion Steam redirected back with, by asking Steam
 * (check_authentication). Returns the SteamID64, or null if anything is off.
 */
export async function verifySteamCallback(
  callbackUrl: URL,
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  const q = callbackUrl.searchParams;
  if (q.get("openid.mode") !== "id_res") return null;
  if (q.get("openid.op_endpoint") !== STEAM_LOGIN) return null;

  // The assertion must be for our own callback, not one minted for another site.
  const returnTo = q.get("openid.return_to");
  if (!returnTo) return null;
  const expected = new URL("/api/steam/callback", baseUrl);
  const actual = new URL(returnTo);
  if (actual.origin !== expected.origin || actual.pathname !== expected.pathname) return null;

  const match = CLAIMED_ID.exec(q.get("openid.claimed_id") ?? "");
  if (!match) return null;

  const body = new URLSearchParams();
  for (const [key, value] of q) {
    if (key.startsWith("openid.")) body.set(key, value);
  }
  body.set("openid.mode", "check_authentication");

  const res = await fetchImpl(STEAM_LOGIN, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) return null;
  const text = await res.text();
  return /^is_valid:true$/m.test(text) ? match[1]! : null;
}
