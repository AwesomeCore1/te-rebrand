import type { LiveDriver } from "@te-rebrand/api/live";
import type * as Leaflet from "leaflet";
import { type Ref, useEffect, useImperativeHandle, useRef, useState } from "react";

import {
  formatSpeed,
  type GameMapConfig,
  gridStep,
  whereLabel,
  worldTransform,
} from "@/lib/live-map";

import "leaflet/dist/leaflet.css";
import "./live-map.css";

export type MapCanvasHandle = {
  /** Bring every driver into view (or the whole map when nobody is driving). */
  fitAll: () => void;
  /** Centre on one driver, zooming in if the map is far out. */
  focus: (driverId: string) => void;
};

type MarkerEntry = {
  marker: Leaflet.Marker;
  root: HTMLElement;
  name: HTMLElement;
  speed: HTMLElement;
  where: HTMLElement;
  more: HTMLElement;
};

type MapState = {
  L: typeof Leaflet;
  map: Leaflet.Map;
  markers: Map<string, MarkerEntry>;
  /** As far in as the map goes by itself: about 6 m per pixel, enough to tell a convoy apart. */
  closeZoom: number;
  fitted: boolean;
};

/** How far drivers' labels reach to the right of their dot, for fitting. */
const LABEL_ROOM_PX = 170;

/**
 * Trucks in a convoy sit on top of each other until you zoom in. Labels that
 * would cover one already placed are hidden (the dot stays), and the label
 * that is shown says how many it stands for: "Kasper 82 km/h +3". The picked
 * driver's label always shows.
 */
function declutter(s: MapState, selectedId: string | null) {
  const placed: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    hidden: number;
    entry: MarkerEntry;
  }[] = [];
  const ordered = [...s.markers].sort(([a], [b]) =>
    a === selectedId ? -1 : b === selectedId ? 1 : a < b ? -1 : 1,
  );
  for (const [, entry] of ordered) {
    entry.root.classList.remove("is-crowded");
    entry.more.textContent = "";
  }
  for (const [id, entry] of ordered) {
    const p = s.map.latLngToLayerPoint(entry.marker.getLatLng());
    const box = {
      left: p.x - 9,
      top: p.y - 13,
      right: p.x - 9 + entry.root.offsetWidth,
      bottom: p.y + 13,
      hidden: 0,
      entry,
    };
    const under = placed.find(
      (o) => box.left < o.right && box.right > o.left && box.top < o.bottom && box.bottom > o.top,
    );
    if (under && id !== selectedId) {
      entry.root.classList.add("is-crowded");
      under.hidden++;
    } else {
      placed.push(box);
    }
  }
  for (const box of placed) {
    if (box.hidden > 0) box.entry.more.textContent = `+${box.hidden}`;
  }
}

/**
 * The map itself: Leaflet on a flat plane in game metres (x east, z south).
 * With a tile URL configured it shows those tiles; without, a coordinate grid.
 * Leaflet needs `window`, so it is loaded in the browser only.
 */
export function MapCanvas({
  config,
  drivers,
  unit,
  selectedId,
  onSelect,
  stale,
  label,
  onGridStep,
  ref,
}: {
  config: GameMapConfig;
  /** Drivers of the game being shown. */
  drivers: LiveDriver[];
  unit: "km" | "mi";
  selectedId: string | null;
  onSelect: (driverId: string | null) => void;
  /** Positions may be out of date (connection lost): markers are dimmed. */
  stale: boolean;
  label: string;
  /** Grid mode only: the distance between grid lines changed (metres). */
  onGridStep?: (metres: number | null) => void;
  ref?: Ref<MapCanvasHandle>;
}) {
  const container = useRef<HTMLDivElement>(null);
  const state = useRef<MapState | null>(null);
  const [ready, setReady] = useState(false);
  // The newest props, for Leaflet event handlers that outlive a render.
  const latest = useRef({ drivers, onSelect, onGridStep, selectedId });
  latest.current = { drivers, onSelect, onGridStep, selectedId };

  const latLng = (L: typeof Leaflet, d: { x: number; z: number }) => L.latLng(-d.z, d.x);

  const fitAll = (animate = true) => {
    const s = state.current;
    if (!s) return;
    const { L, map } = s;
    const points = latest.current.drivers.map((d) => latLng(L, d));
    if (points.length === 0) {
      const { x1, z1, x2, z2 } = config.bounds;
      const world = L.latLngBounds(latLng(L, { x: x1, z: z1 }), latLng(L, { x: x2, z: z2 }));
      // The grid has no edges worth showing: look at the middle third instead.
      map.fitBounds(config.tileUrl ? world : world.pad(-0.33), { animate });
      return;
    }
    map.fitBounds(L.latLngBounds(points), {
      paddingTopLeft: [48, 48],
      paddingBottomRight: [Math.min(LABEL_ROOM_PX, map.getSize().x / 3), 48],
      maxZoom: s.closeZoom,
      animate,
    });
  };

  useImperativeHandle(ref, () => ({
    fitAll: () => fitAll(),
    focus: (driverId) => {
      const s = state.current;
      const entry = s?.markers.get(driverId);
      if (!s || !entry) return;
      s.map.setView(entry.marker.getLatLng(), Math.max(s.map.getZoom(), s.closeZoom));
    },
  }));

  // Create the map; again whenever the game (and so the coordinate system) changes.
  useEffect(() => {
    let cancelled = false;
    let map: Leaflet.Map | undefined;
    let glide: ReturnType<typeof setTimeout> | undefined;

    void import("leaflet").then((module) => {
      const el = container.current;
      if (cancelled || !el) return;
      const L = (module as { default?: typeof Leaflet }).default ?? module;
      const t = worldTransform(config);
      // lat = -z, lng = x, so north is up; pixels come from worldTransform.
      const crs = L.extend({}, L.CRS.Simple, {
        transformation: new L.Transformation(t.a, t.b, -t.c, t.d),
      });
      const maxZoom = config.maxZoom + (config.tileUrl ? 1 : 0);
      map = L.map(el, {
        crs,
        minZoom: 0,
        maxZoom,
        zoomControl: false,
        // Trucks move by setLatLng; Leaflet's own marker zoom animation is enough.
        markerZoomAnimation: true,
      });
      map.attributionControl.setPrefix(
        '<a href="https://leafletjs.com" target="_blank" rel="noreferrer">Leaflet</a>',
      );
      L.control.zoom({ position: "bottomright" }).addTo(map);

      if (config.tileUrl) {
        const { x1, z1, x2, z2 } = config.bounds;
        const world = L.latLngBounds(latLng(L, { x: x1, z: z1 }), latLng(L, { x: x2, z: z2 }));
        const tiles = L.tileLayer(config.tileUrl, {
          tileSize: config.tileSize,
          maxNativeZoom: config.maxZoom,
          maxZoom,
          bounds: world,
          noWrap: true,
        });
        // Plain text from configuration: never let it be read as HTML.
        if (config.attribution) {
          const text = document.createElement("span");
          text.textContent = config.attribution;
          tiles.options.attribution = text.innerHTML;
        }
        tiles.addTo(map);
        map.setMaxBounds(world.pad(0.25));
      } else {
        new (gridLayer(L, t))({ tileSize: config.tileSize, updateWhenZooming: false }).addTo(map);
        const reportStep = () => {
          if (!map) return;
          latest.current.onGridStep?.(gridStep(1 / (t.a * 2 ** Math.round(map.getZoom()))));
        };
        map.on("zoomend", reportStep);
        map.whenReady(reportStep);
      }

      // Between two positions (5 s apart) a marker glides instead of jumping.
      // Zooming moves every marker at once, so the glide is off while it runs.
      const setGlide = (on: boolean) => el.classList.toggle("is-gliding", on);
      map.on("zoomstart", () => {
        clearTimeout(glide);
        setGlide(false);
      });
      map.on("zoomend", () => {
        clearTimeout(glide);
        glide = setTimeout(() => setGlide(true), 80);
        if (state.current) declutter(state.current, latest.current.selectedId);
      });
      map.on("click", () => latest.current.onSelect(null));

      state.current = {
        L,
        map,
        markers: new Map(),
        closeZoom: Math.max(0, Math.min(maxZoom, Math.round(Math.log2(1 / (t.a * 6))))),
        fitted: false,
      };
      fitAll(false);
      glide = setTimeout(() => setGlide(true), 80);
      setReady(true);
    });

    return () => {
      cancelled = true;
      clearTimeout(glide);
      map?.remove();
      state.current = null;
      latest.current.onGridStep?.(null);
      setReady(false);
    };
    // Only `config`: fitAll and latLng read refs, which don't need to be listed.
  }, [config]);

  // Keep one marker per driver, moved in place so it can glide.
  useEffect(() => {
    const s = state.current;
    if (!ready || !s) return;
    const { L, map, markers } = s;
    const seen = new Set<string>();

    for (const d of drivers) {
      seen.add(d.driverId);
      let entry = markers.get(d.driverId);
      if (!entry) {
        entry = createMarker(L, d);
        const id = d.driverId;
        entry.marker.on("click", (e) => {
          L.DomEvent.stopPropagation(e);
          latest.current.onSelect(id);
        });
        entry.marker.addTo(map);
        // Leaflet makes the icon focusable but only acts on Enter for popups.
        entry.marker.getElement()?.addEventListener("keydown", (e) => {
          if (e.key !== "Enter" && e.key !== " ") return;
          e.preventDefault();
          e.stopPropagation();
          latest.current.onSelect(id);
        });
        markers.set(id, entry);
      } else {
        entry.marker.setLatLng(latLng(L, d));
      }
      const selected = d.driverId === selectedId;
      entry.name.textContent = d.displayName;
      entry.speed.textContent = formatSpeed(d.speed_kmh, unit);
      entry.where.textContent = whereLabel(d);
      // Its label may be hidden in a crowd, so the name can't come from the text alone.
      entry.marker
        .getElement()
        ?.setAttribute(
          "aria-label",
          `${d.displayName}, ${formatSpeed(d.speed_kmh, unit)}, ${whereLabel(d)}`,
        );
      entry.root.classList.toggle("is-selected", selected);
      entry.marker.setZIndexOffset(selected ? 1000 : 0);
      // Keep the driver being watched on screen.
      if (selected && !map.getBounds().pad(-0.12).contains(entry.marker.getLatLng())) {
        map.panTo(entry.marker.getLatLng());
      }
    }
    for (const [id, entry] of markers) {
      if (seen.has(id)) continue;
      entry.marker.remove();
      markers.delete(id);
    }
    // Look at the drivers once, when the first ones arrive; after that the
    // viewer is in charge of the view.
    if (!s.fitted && drivers.length > 0) {
      s.fitted = true;
      fitAll(false);
    }
    declutter(s, selectedId);
    // fitAll reads refs only, so it is left out of the list.
  }, [ready, drivers, unit, selectedId]);

  // Leaflet adds its own classes to the map element, so React must never
  // rewrite that element's className: what changes goes on the wrapper.
  return (
    <div className={`absolute inset-0 ${stale ? "is-stale" : ""}`}>
      <div ref={container} role="application" aria-label={label} className="live-map size-full" />
    </div>
  );
}

function createMarker(L: typeof Leaflet, d: LiveDriver): MarkerEntry {
  const root = document.createElement("div");
  root.className = "live-marker";
  const dot = document.createElement("span");
  dot.className = "live-marker-dot";
  const label = document.createElement("span");
  label.className = "live-marker-label";
  const name = document.createElement("span");
  name.className = "live-marker-name";
  const speed = document.createElement("span");
  speed.className = "live-marker-speed";
  const where = document.createElement("span");
  where.className = "live-marker-where";
  const more = document.createElement("span");
  more.className = "live-marker-more";
  label.append(name, speed, where, more);
  root.append(dot, label);
  const marker = L.marker(L.latLng(-d.z, d.x), {
    icon: L.divIcon({ html: root, className: "live-marker-icon", iconSize: [0, 0] }),
    alt: d.displayName,
    keyboard: true,
    riseOnHover: true,
  });
  return { marker, root, name, speed, where, more };
}

const km = (metres: number) => String(Math.round(metres / 100) / 10).replace("-", "−");

/**
 * The background when no tiles are configured: lines every `gridStep` metres
 * of game world, every fifth one stronger and labelled "x, z" in kilometres
 * where two of them cross.
 */
function gridLayer(L: typeof Leaflet, t: ReturnType<typeof worldTransform>) {
  return L.GridLayer.extend({
    createTile(this: Leaflet.GridLayer, coords: Leaflet.Coords) {
      const size = this.getTileSize();
      const canvas = L.DomUtil.create("canvas", "leaflet-tile") as HTMLCanvasElement;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = size.x * ratio;
      canvas.height = size.y * ratio;
      const ctx = canvas.getContext("2d");
      if (!ctx) return canvas;
      ctx.scale(ratio, ratio);

      const scale = 2 ** coords.z;
      const left = coords.x * size.x;
      const top = coords.y * size.y;
      const step = gridStep(1 / (t.a * scale));
      const xToPx = (x: number) => (t.a * x + t.b) * scale - left;
      const zToPx = (z: number) => (t.c * z + t.d) * scale - top;
      const pxToX = (px: number) => ((px + left) / scale - t.b) / t.a;
      const pxToZ = (py: number) => ((py + top) / scale - t.d) / t.c;
      // Labels start at a crossing and run right and down, so a tile also
      // draws the ones that begin just outside it; the two halves line up.
      const firstX = Math.floor(pxToX(-120) / step);
      const lastX = Math.ceil(pxToX(size.x) / step);
      const firstZ = Math.floor(pxToZ(-20) / step);
      const lastZ = Math.ceil(pxToZ(size.y) / step);

      for (const major of [false, true]) {
        ctx.beginPath();
        for (let i = firstX; i <= lastX; i++) {
          if ((i % 5 === 0) !== major) continue;
          const px = Math.round(xToPx(i * step)) + 0.5;
          ctx.moveTo(px, 0);
          ctx.lineTo(px, size.y);
        }
        for (let j = firstZ; j <= lastZ; j++) {
          if ((j % 5 === 0) !== major) continue;
          const py = Math.round(zToPx(j * step)) + 0.5;
          ctx.moveTo(0, py);
          ctx.lineTo(size.x, py);
        }
        ctx.strokeStyle = major ? "rgba(236, 228, 216, 0.17)" : "rgba(236, 228, 216, 0.065)";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      ctx.font = '500 11px "Public Sans Variable", ui-sans-serif, system-ui, sans-serif';
      ctx.fillStyle = "rgba(236, 228, 216, 0.5)";
      ctx.textBaseline = "top";
      for (let i = firstX; i <= lastX; i++) {
        if (i % 5 !== 0) continue;
        for (let j = firstZ; j <= lastZ; j++) {
          if (j % 5 !== 0) continue;
          ctx.fillText(
            `${km(i * step)}, ${km(j * step)}`,
            Math.round(xToPx(i * step)) + 6,
            Math.round(zToPx(j * step)) + 6,
          );
        }
      }
      return canvas;
    },
  }) as unknown as new (options?: Leaflet.GridLayerOptions) => Leaflet.GridLayer;
}
