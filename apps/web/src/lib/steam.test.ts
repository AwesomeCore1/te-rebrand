import { expect, test } from "bun:test";

import { verifySteamCallback } from "./steam";

const BASE = "http://localhost:3001";
const STEAM_ID = "76561197960287930";

function callback(overrides: Record<string, string> = {}) {
  const url = new URL("/api/steam/callback?state=s", BASE);
  const params = {
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.op_endpoint": "https://steamcommunity.com/openid/login",
    "openid.claimed_id": `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    "openid.identity": `https://steamcommunity.com/openid/id/${STEAM_ID}`,
    "openid.return_to": `${BASE}/api/steam/callback?state=s`,
    "openid.sig": "sig",
    ...overrides,
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url;
}

const steamSays = (valid: boolean) =>
  (async (_url: unknown, init?: RequestInit) => {
    const body = init?.body as URLSearchParams;
    expect(body.get("openid.mode")).toBe("check_authentication");
    return new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${valid}\n`);
  }) as typeof fetch;

test("returns the SteamID64 when Steam confirms the assertion", async () => {
  expect(await verifySteamCallback(callback(), BASE, steamSays(true))).toBe(STEAM_ID);
});

test("rejects when Steam says the assertion is invalid", async () => {
  expect(await verifySteamCallback(callback(), BASE, steamSays(false))).toBeNull();
});

test("rejects assertions made for another site", async () => {
  const url = callback({ "openid.return_to": "https://evil.example/api/steam/callback" });
  expect(await verifySteamCallback(url, BASE, steamSays(true))).toBeNull();
});

test("rejects other OpenID providers", async () => {
  const url = callback({ "openid.op_endpoint": "https://evil.example/openid" });
  expect(await verifySteamCallback(url, BASE, steamSays(true))).toBeNull();
});
