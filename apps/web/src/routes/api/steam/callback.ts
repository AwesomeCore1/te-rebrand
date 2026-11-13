import { createFileRoute } from "@tanstack/react-router";
import { refreshTruckersmpId } from "@te-rebrand/api/memberships";

import { ENV } from "../../../env.server";
import { STEAM_STATE_COOKIE, verifySteamCallback } from "../../../lib/steam";
import { auth, db } from "../../../services";

function back(result: "linked" | "failed" | "taken") {
  return new Response(null, {
    status: 302,
    headers: {
      location: new URL(`/dashboard?steam=${result}`, ENV.BETTER_AUTH_URL).toString(),
      "set-cookie": `${STEAM_STATE_COOKIE}=; Path=/api/steam; HttpOnly; SameSite=Lax; Max-Age=0`,
    },
  });
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
        const state = url.searchParams.get("state");
        if (!state || state !== readCookie(request.headers.get("cookie"), STEAM_STATE_COOKIE)) {
          return back("failed");
        }

        const steamId64 = await verifySteamCallback(url, ENV.BETTER_AUTH_URL);
        if (!steamId64) return back("failed");

        const owner = await db.driver.findUnique({ where: { steamId64 } });
        if (owner && owner.userId !== session.user.id) return back("taken");

        const driver = await db.driver.upsert({
          where: { userId: session.user.id },
          create: { userId: session.user.id, displayName: session.user.name, steamId64 },
          update: { steamId64 },
        });
        // Find them on TruckersMP in the background; the redirect doesn't wait for it.
        void refreshTruckersmpId(db, driver).catch(() => undefined);
        return back("linked");
      },
    },
  },
});
