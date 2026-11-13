import type { LiveDriver, LiveMessage } from "@te-rebrand/api/live";
import { useEffect, useRef, useState } from "react";

import { LIVE_CLOSE } from "@/lib/live-map";

export type LiveStatus =
  /** First connection attempt, nothing to show yet. */
  | "connecting"
  | "live"
  /** The connection dropped; retrying on its own. */
  | "lost"
  /** The server refused the company stream: not an active member. No retry. */
  | "denied";

/** No message at all for this long (the server pings every 20 s) means the socket is dead. */
const SILENCE_LIMIT_MS = 45_000;
/**
 * The server removes a driver 30 s after their last position. This is the same
 * rule applied locally, for when the connection is down and its "remove" can't arrive.
 */
const DRIVER_TTL_MS = 35_000;
const MAX_RETRY_MS = 15_000;

/**
 * Drivers on the road, pushed from /api/live/ws. `companyId` null is the
 * public map; with an id it is that company's own stream. Reconnects by
 * itself with a growing delay, and right away when the browser comes back
 * online or the tab is shown again.
 */
export function useLiveDrivers(companyId: string | null) {
  const [state, setState] = useState<{ status: LiveStatus; drivers: LiveDriver[] }>({
    status: "connecting",
    drivers: [],
  });
  const retryNow = useRef<() => void>(() => {});

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let status: LiveStatus = "connecting";
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let silenceTimer: ReturnType<typeof setTimeout> | undefined;
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const drivers = new Map<string, { driver: LiveDriver; seenAt: number }>();

    setState({ status, drivers: [] });

    const flush = () => {
      flushTimer = undefined;
      if (!disposed) setState({ status, drivers: Array.from(drivers.values(), (d) => d.driver) });
    };
    // A convoy sends many updates at once: render them together.
    const scheduleFlush = () => {
      flushTimer ??= setTimeout(flush, 80);
    };

    const handle = (message: LiveMessage) => {
      const now = Date.now();
      if (message.type === "snapshot") {
        drivers.clear();
        for (const d of message.drivers) drivers.set(d.driverId, { driver: d, seenAt: now });
        status = "live";
        attempt = 0;
      } else if (message.type === "update") {
        drivers.set(message.driver.driverId, { driver: message.driver, seenAt: now });
      } else if (message.type === "remove") {
        drivers.delete(message.driverId);
      } else {
        return; // ping
      }
      scheduleFlush();
    };

    const lost = (code?: number) => {
      clearTimeout(silenceTimer);
      socket = null;
      if (disposed) return;
      if (code === LIVE_CLOSE.forbidden) {
        status = "denied";
        drivers.clear();
        return scheduleFlush();
      }
      status = "lost";
      scheduleFlush();
      const delay = Math.min(MAX_RETRY_MS, 1_000 * 2 ** attempt) * (0.7 + Math.random() * 0.6);
      attempt++;
      clearTimeout(retryTimer);
      retryTimer = setTimeout(connect, delay);
    };

    function connect() {
      clearTimeout(retryTimer);
      if (disposed || socket) return;
      const query = companyId ? `?companyId=${encodeURIComponent(companyId)}` : "";
      const scheme = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${scheme}://${location.host}/api/live/ws${query}`);
      socket = ws;
      const watchSilence = () => {
        clearTimeout(silenceTimer);
        silenceTimer = setTimeout(() => {
          if (socket !== ws) return;
          ws.close();
          lost();
        }, SILENCE_LIMIT_MS);
      };
      watchSilence();
      ws.addEventListener("message", (event) => {
        if (socket !== ws) return;
        watchSilence();
        try {
          handle(JSON.parse(String(event.data)) as LiveMessage);
        } catch {
          // Not ours to understand; the next snapshot puts things right.
        }
      });
      ws.addEventListener("close", (event) => {
        if (socket === ws) lost(event.code);
      });
    }

    const prune = setInterval(() => {
      const cutoff = Date.now() - DRIVER_TTL_MS;
      let changed = false;
      for (const [id, d] of drivers) {
        if (d.seenAt < cutoff) changed = drivers.delete(id) || changed;
      }
      if (changed) scheduleFlush();
    }, 5_000);

    const retry = () => {
      if (!disposed && !socket && status !== "denied") connect();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") retry();
    };
    retryNow.current = retry;
    window.addEventListener("online", retry);
    document.addEventListener("visibilitychange", onVisible);
    connect();

    return () => {
      disposed = true;
      clearInterval(prune);
      clearTimeout(retryTimer);
      clearTimeout(silenceTimer);
      clearTimeout(flushTimer);
      window.removeEventListener("online", retry);
      document.removeEventListener("visibilitychange", onVisible);
      socket?.close();
      socket = null;
    };
  }, [companyId]);

  return { ...state, retryNow: () => retryNow.current() };
}
