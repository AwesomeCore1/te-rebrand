import { createFileRoute } from "@tanstack/react-router";
import { type LiveMessage, type LiveScope, liveHub } from "@te-rebrand/api/live";
import { canWatchCompany } from "@te-rebrand/api/routers/live";

import { createContext } from "../../../context";
import { ENV } from "../../../env.server";
import { LIVE_CLOSE } from "../../../lib/live-map";

// The live map stream. One WebSocket per open map:
//   /api/live/ws                  everyone who shows up on the public map
//   /api/live/ws?companyId=<id>   all driving members of that company, for its members
// The server only sends (LiveMessage, as JSON); anything a client sends is ignored.
//
// Nitro (features.websocket in vite.config.ts) upgrades a request when the
// route answers with a response that carries crossws hooks, which is what
// h3's defineWebSocketHandler does too. Doing it from a normal server route
// keeps the stream in the same module graph as POST /api/tracker/position.

/** The parts of a crossws peer used here. */
type Peer = {
  send: (data: string) => unknown;
  close: (code?: number, reason?: string) => void;
};
type Hooks = Partial<Record<"open" | "close" | "error", (peer: Peer) => void>>;

/** How often an open company stream re-checks that the viewer is still a member. */
const MEMBERSHIP_RECHECK_MS = 60_000;

const cleanups = new WeakMap<Peer, () => void>();

/**
 * Browsers send cookies with a WebSocket handshake from any site, so a company
 * stream is only opened for our own pages. Non-browser clients send no Origin
 * and have no cookies to borrow.
 */
function fromOurOwnPage(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === request.headers.get("host") || host === new URL(ENV.BETTER_AUTH_URL).host;
  } catch {
    return false;
  }
}

function hooksFor(scope: LiveScope, allowed: boolean, request: Request): Hooks {
  const stop = (peer: Peer) => {
    cleanups.get(peer)?.();
    cleanups.delete(peer);
  };
  return {
    open(peer) {
      if (!allowed) return peer.close(LIVE_CLOSE.forbidden, "forbidden");
      const unsubscribe = liveHub.subscribe(scope, (message: LiveMessage) => {
        peer.send(JSON.stringify(message));
      });
      if (!unsubscribe) return peer.close(LIVE_CLOSE.busy, "busy");

      let recheck: ReturnType<typeof setInterval> | undefined;
      if (scope.kind === "company") {
        // Membership can end while the map is open (left, removed, logged out).
        recheck = setInterval(async () => {
          try {
            const ctx = await createContext({ req: request });
            if (await canWatchCompany(ctx, scope.companyId)) return;
          } catch {
            return; // database hiccup: keep the stream, check again next time
          }
          stop(peer);
          peer.close(LIVE_CLOSE.forbidden, "forbidden");
        }, MEMBERSHIP_RECHECK_MS);
      }
      cleanups.set(peer, () => {
        unsubscribe();
        clearInterval(recheck);
      });
    },
    close: stop,
    error: stop,
  };
}

export const Route = createFileRoute("/api/live/ws")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const companyId = new URL(request.url).searchParams.get("companyId");
        let scope: LiveScope = { kind: "public" };
        let allowed = true;
        if (companyId !== null) {
          scope = { kind: "company", companyId };
          allowed =
            fromOurOwnPage(request) &&
            (await canWatchCompany(await createContext({ req: request }), companyId));
        }
        // A plain GET (no upgrade) gets the 426; a WebSocket handshake gets the hooks.
        return Object.assign(new Response("This endpoint speaks WebSocket.", { status: 426 }), {
          crossws: hooksFor(scope, allowed, request),
        });
      },
    },
  },
});
