// Live map push: a small pub/sub beside the latest-position store in
// tracker.ts. The store stays the only place positions are kept; this file
// only remembers who is listening and what each listener has been shown, so
// it can tell them when a driver moves, hides or stops sending.
//
// The transport (a WebSocket, apps/web/src/routes/api/live/ws.ts) is not known
// here: a subscriber is just a `send` function.
import { type LivePosition, livePositions, POSITION_TTL_MS, recordPosition } from "./tracker";

/** Which drivers a viewer may see. */
export type LiveScope =
  | { kind: "public" }
  /** Only after the caller's membership was checked (`canWatchCompany`). */
  | { kind: "company"; companyId: string };

/** What a viewer gets about one driver. Never the company id or the privacy flag. */
export type LiveDriver = Pick<
  LivePosition,
  "driverId" | "displayName" | "game" | "multiplayer" | "server" | "x" | "z" | "speed_kmh"
>;

export type LiveMessage =
  /** Sent once, right after subscribing: everyone visible now. */
  | { type: "snapshot"; drivers: LiveDriver[] }
  | { type: "update"; driver: LiveDriver }
  /** The driver hid, left the company, or sent nothing for the TTL. */
  | { type: "remove"; driverId: string }
  /** Keep-alive, so a browser can tell a quiet map from a dead connection. */
  | { type: "ping" };

/** The one visibility rule, the same as `livePositions` in tracker.ts. */
export function visibleTo(scope: LiveScope, p: LivePosition) {
  return scope.kind === "company" ? p.companyId === scope.companyId : p.showOnLiveMap;
}

function toLiveDriver(p: LivePosition): LiveDriver {
  return {
    driverId: p.driverId,
    displayName: p.displayName,
    game: p.game,
    multiplayer: p.multiplayer,
    server: p.server,
    x: p.x,
    z: p.z,
    speed_kmh: p.speed_kmh,
  };
}

type Subscriber = {
  scope: LiveScope;
  send: (message: LiveMessage) => void;
  /** Drivers this subscriber currently has on its map. */
  shown: Set<string>;
};

export type LiveHubOptions = {
  ttlMs?: number;
  pingMs?: number;
  /** How often expiry is checked while anyone is listening. */
  sweepMs?: number;
  /** Open maps across all viewers; more are turned away. */
  maxSubscribers?: number;
  /** Current positions for a scope. Defaults to the store in tracker.ts. */
  snapshot?: (scope: LiveScope, now: number) => LivePosition[];
};

/** Who is listening and what they've been shown. Kept apart from the code that works on it. */
export type LiveHubState = {
  subscribers: Set<Subscriber>;
  /** When each driver last sent a position, to notice the ones that stopped. */
  lastSeen: Map<string, number>;
  timer?: ReturnType<typeof setInterval>;
  lastPing: number;
};

export function newLiveHubState(): LiveHubState {
  return { subscribers: new Set(), lastSeen: new Map(), lastPing: 0 };
}

/**
 * A hub works on `state`. Two hubs on the same state act as one: listeners
 * added through either hear what is published through the other. That is what
 * lets a hot-reloaded copy of this module take over the open connections.
 */
export function createLiveHub(options: LiveHubOptions = {}, state = newLiveHubState()) {
  const ttlMs = options.ttlMs ?? POSITION_TTL_MS;
  const pingMs = options.pingMs ?? 20_000;
  const sweepMs = options.sweepMs ?? 1_000;
  const maxSubscribers = options.maxSubscribers ?? 2_000;
  const snapshot =
    options.snapshot ??
    ((scope, now) =>
      livePositions(scope.kind === "company" ? { companyId: scope.companyId } : {}, now));

  const { subscribers, lastSeen } = state;

  function stopTimer() {
    clearInterval(state.timer);
    state.timer = undefined;
  }
  function startTimer() {
    state.timer = setInterval(sweep, sweepMs);
    // Never keep the process alive just for the map.
    (state.timer as { unref?: () => void }).unref?.();
  }

  function drop(subscriber: Subscriber) {
    subscribers.delete(subscriber);
    if (subscribers.size === 0) stopTimer();
  }

  /** A listener whose connection broke must not stop the others, or the tracker's POST. */
  function deliver(subscriber: Subscriber, message: LiveMessage) {
    try {
      subscriber.send(message);
    } catch {
      drop(subscriber);
    }
  }

  /** Tells every listener about one new position. Call after storing it. */
  function publish(position: LivePosition) {
    lastSeen.set(position.driverId, position.receivedAt);
    for (const s of subscribers) {
      if (visibleTo(s.scope, position)) {
        s.shown.add(position.driverId);
        deliver(s, { type: "update", driver: toLiveDriver(position) });
      } else if (s.shown.delete(position.driverId)) {
        // Was visible to this listener, now isn't: hidden, or changed company.
        deliver(s, { type: "remove", driverId: position.driverId });
      }
    }
  }

  /** Removes drivers who sent nothing for the TTL from every open map. */
  function sweep(now = Date.now()) {
    for (const [driverId, at] of lastSeen) {
      if (now - at <= ttlMs) continue;
      lastSeen.delete(driverId);
      for (const s of subscribers) {
        if (s.shown.delete(driverId)) deliver(s, { type: "remove", driverId });
      }
    }
    if (now - state.lastPing >= pingMs) {
      state.lastPing = now;
      for (const s of subscribers) deliver(s, { type: "ping" });
    }
  }

  /**
   * Starts sending to `send`: a snapshot first, then changes. Returns the
   * function that stops it (call it when the connection closes), or `null`
   * when the server already has `maxSubscribers` open maps.
   */
  function subscribe(scope: LiveScope, send: Subscriber["send"], now = Date.now()) {
    if (subscribers.size >= maxSubscribers) return null;
    const current = snapshot(scope, now);
    for (const p of current) {
      if (!lastSeen.has(p.driverId)) lastSeen.set(p.driverId, p.receivedAt);
    }
    const subscriber: Subscriber = {
      scope,
      send,
      shown: new Set(current.map((p) => p.driverId)),
    };
    subscribers.add(subscriber);
    deliver(subscriber, { type: "snapshot", drivers: current.map(toLiveDriver) });
    if (!state.timer && subscribers.has(subscriber)) {
      state.lastPing = now;
      startTimer();
    }
    return () => drop(subscriber);
  }

  // Taking over a state that already has listeners: run the timer with this
  // hub's code instead of the previous one's.
  if (state.timer) {
    stopTimer();
    if (subscribers.size > 0) startTimer();
  }

  return {
    publish,
    subscribe,
    sweep,
    get subscriberCount() {
      return subscribers.size;
    },
  };
}

export type LiveHub = ReturnType<typeof createLiveHub>;

// One set of listeners per server process. Only the state lives on globalThis:
// when `vite dev` hot-reloads this module (or tracker.ts under it), the new
// copy builds a new hub on the same state, so open sockets keep getting
// positions and new ones get their snapshot from the current store.
const STATE_KEY = Symbol.for("tacho.live-hub.state.v1");
const globals = globalThis as { [STATE_KEY]?: LiveHubState };
export const liveHub: LiveHub = createLiveHub({}, (globals[STATE_KEY] ??= newLiveHubState()));

/** Stores the latest position and pushes it to open maps. Used by POST /api/tracker/position. */
export function recordLivePosition(position: LivePosition) {
  recordPosition(position);
  liveHub.publish(position);
}
