import { createFileRoute } from "@tanstack/react-router";
import { authenticateDevice, recordPosition } from "@te-rebrand/api/tracker";
import { PositionUpdateSchema } from "@te-rebrand/telemetry-types";

import { json, readBody } from "../../../lib/tracker-http";
import { db } from "../../../services";

// Live map: sent every 5 s while driving. Only the latest position is kept, in memory.
export const Route = createFileRoute("/api/tracker/position")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const device = await authenticateDevice(db, request.headers.get("authorization"));
        if (!device) return json({ error: "unauthorized" }, 401);
        const body = await readBody(request, PositionUpdateSchema);
        if (!body.ok) return body.response;
        const membership = await db.membership.findFirst({
          where: { driverId: device.driverId, status: "active" },
          select: { companyId: true },
        });
        recordPosition({
          ...body.data,
          driverId: device.driverId,
          displayName: device.driver.displayName,
          companyId: membership?.companyId ?? null,
          showOnLiveMap: device.driver.showOnLiveMap,
          receivedAt: Date.now(),
        });
        return new Response(null, { status: 204 });
      },
    },
  },
});
