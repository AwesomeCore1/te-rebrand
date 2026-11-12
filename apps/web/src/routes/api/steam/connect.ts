import { createFileRoute } from "@tanstack/react-router";

import { ENV } from "../../../env.server";
import { STEAM_STATE_COOKIE, steamLoginUrl } from "../../../lib/steam";
import { auth } from "../../../services";

// "Connect Steam": sends a logged-in driver to Steam's sign-in page.
export const Route = createFileRoute("/api/steam/connect")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const session = await auth.api.getSession({ headers: request.headers });
        if (!session) return Response.redirect(new URL("/login", ENV.BETTER_AUTH_URL), 302);

        const state = crypto.randomUUID();
        const secure = ENV.BETTER_AUTH_URL.startsWith("https://") ? "; Secure" : "";
        return new Response(null, {
          status: 302,
          headers: {
            location: steamLoginUrl(ENV.BETTER_AUTH_URL, state),
            "set-cookie": `${STEAM_STATE_COOKIE}=${state}; Path=/api/steam; HttpOnly; SameSite=Lax; Max-Age=600${secure}`,
          },
        });
      },
    },
  },
});
