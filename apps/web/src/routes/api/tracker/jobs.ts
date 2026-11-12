import { createFileRoute } from "@tanstack/react-router";
import { authenticateDevice, ingestJob } from "@te-rebrand/api/tracker";
import { JobUploadSchema } from "@te-rebrand/telemetry-types";

import { json, readBody } from "../../../lib/tracker-http";
import { db } from "../../../services";

// One finished (delivered or cancelled) job. Idempotent on client_job_id.
export const Route = createFileRoute("/api/tracker/jobs")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const device = await authenticateDevice(db, request.headers.get("authorization"));
        if (!device) return json({ error: "unauthorized" }, 401);
        const body = await readBody(request, JobUploadSchema);
        if (!body.ok) return body.response;
        const job = await ingestJob(db, device, body.data);
        return json({ id: job.id, status: job.status, flag_reasons: job.flagReasons }, 201);
      },
    },
  },
});
