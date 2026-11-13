// Shared by the live map page and its server side: how a game world is laid
// out on the map, speed formatting, and the WebSocket close codes.
import { KM_PER_MILE } from "./format";

export type Game = "ets2" | "ats";
export const GAMES: readonly Game[] = ["ets2", "ats"];
export const GAME_LABEL: Record<Game, "ETS2" | "ATS"> = { ets2: "ETS2", ats: "ATS" };

/** Close codes of /api/live/ws that the page treats differently from a dropped connection. */
export const LIVE_CLOSE = {
  /** Not an active member of the company asked for. Don't retry. */
  forbidden: 4403,
  /** The server has its limit of open maps. Retry later. */
  busy: 1013,
} as const;

/** How one game's world is drawn. */
export type GameMapConfig = {
  /** Leaflet tile URL template, or null for the built-in coordinate grid. */
  tileUrl: string | null;
  attribution: string | null;
  /**
   * Game metres (x east, z south) at the top-left and bottom-right corners of
   * the one tile that shows the whole map at zoom 0.
   */
  bounds: { x1: number; z1: number; x2: number; z2: number };
  tileSize: number;
  maxZoom: number;
};
export type LiveMapConfig = Record<Game, GameMapConfig>;

// Without tiles the world is a square of 262 144 m around a point near the
// middle of each game's road network, so zoom 0 is 1024 m per pixel and every
// zoom step halves that. The centres are rough: they only decide what an empty
// map looks at, since markers are placed from real game coordinates either way.
const GRID_SPAN_M = 262_144;
const GRID_CENTRE: Record<Game, { x: number; z: number }> = {
  ets2: { x: 20_000, z: -10_000 },
  ats: { x: -55_000, z: -5_000 },
};

export function gridConfig(game: Game): GameMapConfig {
  const { x, z } = GRID_CENTRE[game];
  const half = GRID_SPAN_M / 2;
  return {
    tileUrl: null,
    attribution: null,
    bounds: { x1: x - half, z1: z - half, x2: x + half, z2: z + half },
    tileSize: 256,
    maxZoom: 9,
  };
}

/** "x1,z1,x2,z2" in game metres. Null when it isn't four numbers spanning an area. */
export function parseBounds(value: string | undefined): GameMapConfig["bounds"] | null {
  if (!value) return null;
  const parts = value.split(",").map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [x1, z1, x2, z2] = parts as [number, number, number, number];
  if (x1 === x2 || z1 === z2) return null;
  return { x1, z1, x2, z2 };
}

function intBetween(value: string | undefined, min: number, max: number, fallback: number) {
  const n = Number(value);
  return value && Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

type MapEnv = Partial<Record<`LIVE_MAP_${"ETS2" | "ATS"}_${MapEnvKey}`, string>>;
type MapEnvKey = "TILE_URL" | "BOUNDS" | "MAX_ZOOM" | "TILE_SIZE" | "ATTRIBUTION";

/**
 * Reads the optional LIVE_MAP_* variables (apps/web/.env.schema). A game with
 * no tile URL, or with one but without usable bounds, gets the grid.
 */
export function mapConfigFromEnv(env: MapEnv): { config: LiveMapConfig; problems: string[] } {
  const problems: string[] = [];
  const one = (game: Game): GameMapConfig => {
    const prefix = `LIVE_MAP_${GAME_LABEL[game]}` as const;
    const tileUrl = env[`${prefix}_TILE_URL`]?.trim();
    if (!tileUrl) return gridConfig(game);
    const bounds = parseBounds(env[`${prefix}_BOUNDS`]);
    if (!bounds) {
      problems.push(
        `${prefix}_TILE_URL is set but ${prefix}_BOUNDS is not "x1,z1,x2,z2": using the grid.`,
      );
      return gridConfig(game);
    }
    return {
      tileUrl,
      attribution: env[`${prefix}_ATTRIBUTION`]?.trim() || null,
      bounds,
      tileSize: intBetween(env[`${prefix}_TILE_SIZE`], 64, 2048, 256),
      maxZoom: intBetween(env[`${prefix}_MAX_ZOOM`], 0, 20, 8),
    };
  };
  return { config: { ets2: one("ets2"), ats: one("ats") }, problems };
}

/**
 * Game metres to pixels at zoom 0: `px = a * x + b`, `py = c * z + d`. The map
 * multiplies by 2^zoom from there (Leaflet's CRS.Simple).
 */
export function worldTransform({ bounds, tileSize }: GameMapConfig) {
  const a = tileSize / (bounds.x2 - bounds.x1);
  const c = tileSize / (bounds.z2 - bounds.z1);
  return { a, b: -bounds.x1 * a, c, d: -bounds.z1 * c };
}

const GRID_STEPS_M = [100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000];

/** Distance between grid lines so they sit at least `minPx` apart on screen. */
export function gridStep(metresPerPixel: number, minPx = 56) {
  return GRID_STEPS_M.find((s) => s / metresPerPixel >= minPx) ?? 200_000;
}

/** Speed arrives in km/h; mph is a display conversion only. */
export function formatSpeed(kmh: number, unit: "km" | "mi") {
  return unit === "mi" ? `${Math.round(kmh / KM_PER_MILE)} mph` : `${Math.round(kmh)} km/h`;
}

/** Where a driver is playing, for the marker and the list. */
export function whereLabel(driver: { multiplayer: boolean; server: string | null }) {
  if (!driver.multiplayer) return "Singleplayer";
  return driver.server ? `TruckersMP · ${driver.server}` : "TruckersMP";
}
