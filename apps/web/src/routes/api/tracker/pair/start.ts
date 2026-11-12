import { createFileRoute } from "@tanstack/react-router";
import { PAIRING_POLL_INTERVAL_S, startPairing } from "@te-rebrand/api/tracker";
import { PairStartSchema } from "@te-rebrand/telemetry-types";

import { ENV } from "../../../../env.server";
import { json, readBody } from "../../../../lib/tracker-http";
import { db } from "../../../../services";

// Step 1 of linking the tracker: the app asks for a code, then opens
// verification_url in the browser where the driver is logged in with Discord.
export const Route = createFileRoute("/api/tracker/pair/start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readBody(request, PairStartSchema);
        if (!body.ok) return body.response;
        const p = await startPairing(db, body.data.device_name, body.data.app_version);
        const url = new URL("/tracker/link", ENV.BETTER_AUTH_URL);
        url.searchParams.set("code", p.userCode);
        return json({
          device_code: p.deviceCode,
          user_code: p.userCode,
          verification_url: url.toString(),
          expires_in: p.expiresIn,
          interval: PAIRING_POLL_INTERVAL_S,
        });
      },
    },
  },
});
