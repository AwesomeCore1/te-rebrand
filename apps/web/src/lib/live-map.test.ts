import { expect, test } from "bun:test";

import {
  formatSpeed,
  gridConfig,
  gridStep,
  mapConfigFromEnv,
  parseBounds,
  whereLabel,
  worldTransform,
} from "./live-map";

test("with no LIVE_MAP_* variables both games get the grid", () => {
  const { config, problems } = mapConfigFromEnv({});
  expect(problems).toEqual([]);
  expect(config.ets2).toEqual(gridConfig("ets2"));
  expect(config.ats).toEqual(gridConfig("ats"));
  expect(config.ets2.tileUrl).toBeNull();
});

test("tiles are configured per game", () => {
  const { config, problems } = mapConfigFromEnv({
    LIVE_MAP_ETS2_TILE_URL: " https://tiles.example.com/ets2/{z}/{x}/{y}.png ",
    LIVE_MAP_ETS2_BOUNDS: "-94621.8, -80209.1, 79370.13, 93782.77",
    LIVE_MAP_ETS2_MAX_ZOOM: "7",
    LIVE_MAP_ETS2_TILE_SIZE: "512",
    LIVE_MAP_ETS2_ATTRIBUTION: "Map data: SCS Software",
  });
  expect(problems).toEqual([]);
  expect(config.ets2).toEqual({
    tileUrl: "https://tiles.example.com/ets2/{z}/{x}/{y}.png",
    attribution: "Map data: SCS Software",
    bounds: { x1: -94621.8, z1: -80209.1, x2: 79370.13, z2: 93782.77 },
    tileSize: 512,
    maxZoom: 7,
  });
  // ATS was left alone.
  expect(config.ats.tileUrl).toBeNull();
});

test("a tile URL without usable bounds falls back to the grid and says why", () => {
  for (const bounds of [undefined, "", "1,2,3", "a,b,c,d", "0,0,0,10", "0,5,10,5"]) {
    const { config, problems } = mapConfigFromEnv({
      LIVE_MAP_ATS_TILE_URL: "https://tiles.example.com/ats/{z}/{x}/{y}.png",
      LIVE_MAP_ATS_BOUNDS: bounds,
    });
    expect(config.ats).toEqual(gridConfig("ats"));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("LIVE_MAP_ATS_BOUNDS");
  }
});

test("zoom and tile size fall back to defaults when missing or nonsense", () => {
  const one = (zoom?: string, size?: string) =>
    mapConfigFromEnv({
      LIVE_MAP_ETS2_TILE_URL: "https://t.example/{z}/{x}/{y}.png",
      LIVE_MAP_ETS2_BOUNDS: "0,0,100,100",
      LIVE_MAP_ETS2_MAX_ZOOM: zoom,
      LIVE_MAP_ETS2_TILE_SIZE: size,
    }).config.ets2;
  expect(one()).toMatchObject({ maxZoom: 8, tileSize: 256, attribution: null });
  expect(one("abc", "-1")).toMatchObject({ maxZoom: 8, tileSize: 256 });
  expect(one("6.5", "99999")).toMatchObject({ maxZoom: 8, tileSize: 256 });
  expect(one("0", "512")).toMatchObject({ maxZoom: 0, tileSize: 512 });
});

test("parseBounds", () => {
  expect(parseBounds("-10, 20,30,-40")).toEqual({ x1: -10, z1: 20, x2: 30, z2: -40 });
  expect(parseBounds("1,2,3,4,5")).toBeNull();
  expect(parseBounds(undefined)).toBeNull();
});

test("worldTransform puts the bounds' corners on the corners of the zoom-0 tile", () => {
  const config = {
    ...gridConfig("ets2"),
    bounds: { x1: -94_000, z1: -80_000, x2: 80_000, z2: 94_000 },
    tileSize: 512,
  };
  const t = worldTransform(config);
  const px = (x: number) => t.a * x + t.b;
  const py = (z: number) => t.c * z + t.d;
  expect(px(-94_000)).toBeCloseTo(0);
  expect(py(-80_000)).toBeCloseTo(0);
  expect(px(80_000)).toBeCloseTo(512);
  expect(py(94_000)).toBeCloseTo(512);
  // The middle of the world is the middle of the tile; z grows downwards (south).
  expect(px(-7_000)).toBeCloseTo(256);
  expect(py(7_000)).toBeCloseTo(256);
  expect(py(8_000)).toBeGreaterThan(py(7_000));
});

test("the built-in grid is 1024 m per pixel at zoom 0", () => {
  const t = worldTransform(gridConfig("ats"));
  expect(1 / t.a).toBe(1024);
  expect(1 / t.c).toBe(1024);
});

test("gridStep keeps lines readable at every zoom", () => {
  expect(gridStep(1024)).toBe(100_000);
  expect(gridStep(128)).toBe(10_000);
  expect(gridStep(16)).toBe(1_000);
  expect(gridStep(2)).toBe(200);
  expect(gridStep(1)).toBe(100);
  expect(gridStep(100_000)).toBe(200_000);
  for (const mpp of [1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]) {
    expect(gridStep(mpp) / mpp).toBeGreaterThanOrEqual(56);
  }
});

test("speed is shown in the viewer's unit; km/h is what's stored", () => {
  expect(formatSpeed(80.4, "km")).toBe("80 km/h");
  expect(formatSpeed(80.4, "mi")).toBe("50 mph");
  expect(formatSpeed(0, "mi")).toBe("0 mph");
  expect(formatSpeed(104.6, "mi")).toBe("65 mph");
});

test("whereLabel names the TruckersMP server when it is known", () => {
  expect(whereLabel({ multiplayer: true, server: "Simulation 1" })).toBe(
    "TruckersMP · Simulation 1",
  );
  expect(whereLabel({ multiplayer: true, server: null })).toBe("TruckersMP");
  expect(whereLabel({ multiplayer: false, server: null })).toBe("Singleplayer");
});
