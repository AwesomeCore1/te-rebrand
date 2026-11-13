import { createFileRoute } from "@tanstack/react-router";

import { ENV } from "../../../env.server";
import { safeReturnPath } from "../../../lib/return-path";
import { STEAM_RETURN_COOKIE, STEAM_STATE_COOKIE, steamLoginUrl } from "../../../lib/steam";
import { auth } from "../../../services";

// "Connect Steam": sends a logged-in driver to Steam's sign-in page.
// `?return=/vtc/new` brings them back to that page afterwards instead of the
// dashboard. Only a path on this site is kept (lib/return-path.ts); anything
// else is dropped and they land on the dashboard.
export const Route = createFileRoute("/api/steam/connect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) return Response.redirect(new URL("/login", ENV.BETTER_AUTH_URL), 302);

        const state = crypto.randomUUID();
        const returnTo = safeReturnPath(new URL(request.url).searchParams.get("return"));
        const secure = ENV.BETTER_AUTH_URL.startsWith("https://") ? "; Secure" : "";
        const cookie = (name: string, value: string, maxAge: number) =>
          `${name}=${value}; Path=/api/steam; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;

        const headers = new Headers({ location: steamLoginUrl(ENV.BETTER_AUTH_URL, state) });
        headers.append("set-cookie", cookie(STEAM_STATE_COOKIE, state, 600));
        // Without a return path, one left over from an earlier try is cleared.
        headers.append(
          "set-cookie",
          returnTo
            ? cookie(STEAM_RETURN_COOKIE, encodeURIComponent(returnTo), 600)
            : cookie(STEAM_RETURN_COOKIE, "", 0),
        );
        return new Response(null, { status: 302, headers });
      },
    },
  },
});
