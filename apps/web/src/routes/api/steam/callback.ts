import { createFileRoute } from "@tanstack/react-router";
import { refreshTruckersmpId } from "@te-rebrand/api/memberships";

import { ENV } from "../../../env.server";
import { safeReturnPath, withParam } from "../../../lib/return-path";
import { STEAM_RETURN_COOKIE, STEAM_STATE_COOKIE, verifySteamCallback } from "../../../lib/steam";
import { auth, db } from "../../../services";

/**
 * Back to the page the driver came from (the dashboard unless /connect was
 * given another), with `?steam=<result>` for that page to show. `returnTo` is
 * the raw cookie: it is checked again here, so a cookie someone planted can
 * only ever name a page of this site.
 */
function back(result: "linked" | "failed" | "taken", returnTo: string | undefined) {
  let path: string | null = null;
  try {
    path = safeReturnPath(returnTo ? decodeURIComponent(returnTo) : null);
  } catch {
    // Not valid percent-encoding: the dashboard it is.
  }
  const headers = new Headers({
    location: new URL(
      withParam(path ?? "/dashboard", "steam", result),
      ENV.BETTER_AUTH_URL,
    ).toString(),
  });
  for (const name of [STEAM_STATE_COOKIE, STEAM_RETURN_COOKIE]) {
    headers.append("set-cookie", `${name}=; Path=/api/steam; HttpOnly; SameSite=Lax; Max-Age=0`);
  }
  return new Response(null, { status: 302, headers });
}

function readCookie(header: string | null, name: string) {
  for (const part of header?.split(";") ?? []) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

export const Route = createFileRoute("/api/steam/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) return Response.redirect(new URL("/login", ENV.BETTER_AUTH_URL), 302);

        const url = new URL(request.url);
        const cookies = request.headers.get("cookie");
        const returnTo = readCookie(cookies, STEAM_RETURN_COOKIE);
        const state = url.searchParams.get("state");
        if (!state || state !== readCookie(cookies, STEAM_STATE_COOKIE)) {
          return back("failed", returnTo);
        }

        const steamId64 = await verifySteamCallback(url, ENV.BETTER_AUTH_URL);
        if (!steamId64) return back("failed", returnTo);

        const owner = await db.driver.findUnique({ where: { steamId64 } });
        if (owner && owner.userId !== session.user.id) return back("taken", returnTo);

        const driver = await db.driver.upsert({
          where: { userId: session.user.id },
          create: { userId: session.user.id, displayName: session.user.name, steamId64 },
          update: { steamId64 },
        });
        // Find them on TruckersMP in the background; the redirect doesn't wait for it.
        void refreshTruckersmpId(db, driver).catch(() => undefined);
        return back("linked", returnTo);
      },
    },
  },
});
