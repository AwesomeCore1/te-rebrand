import { createFileRoute } from "@tanstack/react-router";
import { pollPairing } from "@te-rebrand/api/tracker";
import { PairPollSchema } from "@te-rebrand/telemetry-types";

import { json, readBody } from "../../../../lib/tracker-http";
import { db } from "../../../../services";

// Step 2: the app polls until the driver approves; the token is returned once.
export const Route = createFileRoute("/api/tracker/pair/poll")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readBody(request, PairPollSchema);
        if (!body.ok) return body.response;
        const r = await pollPairing(db, body.data.device_code);
        if (r.status === "approved") {
          return json({ status: "approved", token: r.token, driver_name: r.driverName });
        }
        return json({ status: r.status });
      },
    },
  },
});
