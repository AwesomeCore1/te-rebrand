import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { LiveDriver } from "@te-rebrand/api/live";
import { Maximize, WifiOff } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { MapCanvas, type MapCanvasHandle } from "@/components/live-map/map-canvas";
import { type LiveStatus, useLiveDrivers } from "@/components/live-map/use-live-drivers";
import { getMapConfig } from "@/functions/get-map-config";
import { authClient } from "@/lib/auth-client";
import { formatSpeed, type Game, GAME_LABEL, GAMES, whereLabel } from "@/lib/live-map";
import { useTRPC } from "@/utils/trpc";

// Who is driving right now. Positions arrive over a WebSocket (/api/live/ws):
// the public stream for everyone, the company stream for its members.
export const Route = createFileRoute("/map")({
  validateSearch: z.object({
    game: z.enum(["ets2", "ats"]).optional().catch(undefined),
    view: z.enum(["company"]).optional().catch(undefined),
  }),
  loader: () => getMapConfig(),
  head: () => ({ meta: [{ title: "Live map · Tacho" }] }),
  component: LiveMapPage,
});

function LiveMapPage() {
  const config = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const trpc = useTRPC();
  const { data: session } = authClient.useSession();
  const viewer = useQuery({ ...trpc.live.viewer.queryOptions(), enabled: Boolean(session) });

  const company = viewer.data?.company ?? null;
  const companyView = search.view === "company" && company !== null;
  const live = useLiveDrivers(companyView ? company.id : null);
  const unit = viewer.data?.unitPreference ?? "km";

  const counts = useMemo(() => {
    const c: Record<Game, number> = { ets2: 0, ats: 0 };
    for (const d of live.drivers) c[d.game]++;
    return c;
  }, [live.drivers]);

  // Until the viewer picks a game, open on the one people are driving in.
  const [openingGame, setOpeningGame] = useState<Game | null>(null);
  useEffect(() => {
    if (live.status === "live" && openingGame === null) {
      setOpeningGame(counts.ets2 === 0 && counts.ats > 0 ? "ats" : "ets2");
    }
  }, [live.status, openingGame, counts]);
  const game = search.game ?? openingGame ?? "ets2";
  const otherGame = game === "ets2" ? "ats" : "ets2";

  const drivers = useMemo(
    () =>
      live.drivers
        .filter((d) => d.game === game)
        .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    [live.drivers, game],
  );

  const [pickedId, setPickedId] = useState<string | null>(null);
  const selectedId = drivers.some((d) => d.driverId === pickedId) ? pickedId : null;
  const canvas = useRef<MapCanvasHandle>(null);
  const mapArea = useRef<HTMLDivElement>(null);
  const [gridStepM, setGridStepM] = useState<number | null>(null);

  const setSearch = (patch: { game?: Game; view?: "company" | undefined }) =>
    navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true });

  // The server closed the company stream: membership ended while the map was open.
  const queryClient = useQueryClient();
  const denied = live.status === "denied";
  useEffect(() => {
    if (!denied) return;
    toast.info("You're no longer in that company. Showing everyone.");
    void queryClient.invalidateQueries({ queryKey: trpc.live.viewer.queryKey() });
    void navigate({ search: (prev) => ({ ...prev, view: undefined }), replace: true });
  }, [denied, navigate, queryClient, trpc]);

  const pick = (driverId: string) => {
    setPickedId(driverId);
    canvas.current?.focus(driverId);
    mapArea.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };

  const tiles = config[game].tileUrl !== null;
  const summary = `${drivers.length} ${drivers.length === 1 ? "driver" : "drivers"} · ${GAME_LABEL[game]}`;

  return (
    <main className="mx-auto w-full max-w-6xl px-5 pt-28 pb-16 md:px-8">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div>
          <h1 className="text-[clamp(2rem,4vw,2.75rem)] leading-none font-extrabold">Live map</h1>
          <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            {companyView
              ? `Everyone driving for ${company.name} right now, including members who stay off the public map.`
              : "Drivers on the road right now, updated every 5 seconds. Each driver chooses whether to appear here."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Segmented
            label="Game"
            value={game}
            onChange={(g) => setSearch({ game: g })}
            options={GAMES.map((g) => ({
              value: g,
              label: GAME_LABEL[g],
              count: live.status === "connecting" ? undefined : counts[g],
            }))}
          />
          {company && (
            <Segmented
              label="Whose drivers to show"
              value={companyView ? "company" : "everyone"}
              onChange={(v) => setSearch({ view: v === "company" ? "company" : undefined })}
              options={[
                { value: "everyone", label: "Everyone" },
                { value: "company", label: "My company" },
              ]}
            />
          )}
        </div>
      </header>

      <section
        aria-label={`Live map, ${GAME_LABEL[game]}`}
        className="mt-6 overflow-hidden rounded-3xl border border-white/10 bg-[#1b140f] text-[#ece4d8] lg:grid lg:h-[clamp(27rem,68svh,42rem)] lg:grid-cols-[minmax(0,1fr)_19rem]"
      >
        <div
          ref={mapArea}
          className="relative isolate h-[clamp(21rem,58svh,34rem)] scroll-mt-24 lg:h-auto"
        >
          <MapCanvas
            ref={canvas}
            key={game}
            config={config[game]}
            drivers={drivers}
            unit={unit}
            selectedId={selectedId}
            onSelect={setPickedId}
            stale={live.status === "lost"}
            label={`Map of drivers in ${GAME_LABEL[game]}. The same drivers are listed after the map.`}
            onGridStep={setGridStepM}
          />

          <div className="pointer-events-none absolute inset-x-3 top-3 z-[1000] flex items-start justify-between gap-2">
            <StatusChip status={live.status} onRetry={live.retryNow} />
            <button
              type="button"
              onClick={() => canvas.current?.fitAll()}
              aria-label={drivers.length > 0 ? "Show all drivers" : "Reset the view"}
              title={drivers.length > 0 ? "Show all drivers" : "Reset the view"}
              className="pointer-events-auto flex size-10 items-center justify-center rounded-[10px] border border-white/12 bg-[#241b14] text-[#ece4d8] transition-[background-color,transform] duration-150 ease-out hover:bg-[#33261b] focus-visible:ring-2 focus-visible:ring-[#f5a524] focus-visible:outline-none active:scale-[0.97]"
            >
              <Maximize aria-hidden="true" className="size-[18px]" />
            </button>
          </div>

          {live.status !== "connecting" && drivers.length === 0 && (
            <div className="pointer-events-none absolute inset-0 z-[1000] flex items-center justify-center p-6">
              <div className="pointer-events-auto max-w-xs rounded-2xl border border-white/10 bg-[#120c07]/92 px-6 py-5 text-center">
                <p className="font-display text-lg font-bold">
                  {counts[otherGame] > 0
                    ? `Nobody is driving in ${GAME_LABEL[game]} right now`
                    : "Nobody is driving right now"}
                </p>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-[#cfc5b8]">
                  {counts[otherGame] > 0
                    ? `${counts[otherGame]} ${counts[otherGame] === 1 ? "driver is" : "drivers are"} on the road in ${GAME_LABEL[otherGame]}.`
                    : companyView
                      ? `Members of ${company.name} show up here as soon as they drive with the tracker running.`
                      : "Trucks show up here as soon as someone drives with the tracker running."}
                </p>
                {counts[otherGame] > 0 && (
                  <button
                    type="button"
                    onClick={() => setSearch({ game: otherGame })}
                    className="mt-3 h-9 rounded-lg border border-white/15 bg-white/5 px-3.5 text-[13px] font-semibold transition-[background-color,transform] duration-150 ease-out hover:bg-white/10 focus-visible:ring-2 focus-visible:ring-[#f5a524] focus-visible:outline-none active:scale-[0.97]"
                  >
                    Show {GAME_LABEL[otherGame]}
                  </button>
                )}
              </div>
            </div>
          )}

          {!tiles && gridStepM !== null && (
            <p className="tabular pointer-events-none absolute bottom-3 left-3 z-[1000] rounded-lg bg-[#120c07]/80 px-2.5 py-1 text-[11.5px] text-[#a89d90]">
              Grid lines every {gridStepM >= 1000 ? `${gridStepM / 1000} km` : `${gridStepM} m`} ·
              game coordinates
            </p>
          )}
        </div>

        <div className="flex min-h-0 flex-col border-t border-white/10 lg:border-t-0 lg:border-l">
          <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 text-[13px]">
            <h2 className="font-sans text-[13px] font-semibold tracking-normal">On the road</h2>
            <span className="tabular text-[#a89d90]">
              {live.status === "connecting" ? "Connecting" : summary}
            </span>
          </div>
          <DriverList
            status={live.status}
            drivers={drivers}
            unit={unit}
            selectedId={selectedId}
            onPick={pick}
          />
        </div>
      </section>

      {viewer.data ? (
        <VisibilityToggle shown={viewer.data.showOnLiveMap} inCompany={company !== null} />
      ) : session ? null : (
        <p className="mt-4 text-[14px] text-muted-foreground">
          <Link
            to="/login"
            search={{ redirect: "/map" }}
            className="font-semibold text-signal-ink underline-offset-4 hover:underline"
          >
            Log in
          </Link>{" "}
          to see everyone in your company, including members who stay off the public map.
        </p>
      )}
    </main>
  );
}

function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; count?: number }[];
}) {
  return (
    <div className="flex rounded-lg border bg-card p-1" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`flex h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold transition-[background-color,color,transform] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none active:scale-[0.97] ${
            value === o.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
          {o.count !== undefined && (
            <span className="tabular text-[12px] font-medium opacity-80">
              <span className="sr-only">, </span>
              {o.count}
              <span className="sr-only"> driving</span>
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

function StatusChip({ status, onRetry }: { status: LiveStatus; onRetry: () => void }) {
  const lost = status === "lost";
  const text =
    status === "live" ? "Live" : lost ? "Connection lost. Reconnecting" : "Connecting to the map";
  return (
    <div
      role="status"
      className="pointer-events-auto flex min-h-10 items-center gap-2 rounded-[10px] border border-white/12 bg-[#120c07]/92 py-1.5 pr-2 pl-3 text-[13px] font-medium"
    >
      {lost ? (
        <WifiOff aria-hidden="true" className="size-4 shrink-0 text-[#f5b04a]" />
      ) : (
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full ${
            status === "live"
              ? "bg-[#5fd394]"
              : "animate-pulse bg-[#a89d90] motion-reduce:animate-none"
          }`}
        />
      )}
      <span className={status === "live" ? "pr-1.5" : "pr-1"}>
        {text}
        {status !== "live" && "…"}
      </span>
      {lost && (
        <button
          type="button"
          onClick={onRetry}
          className="h-7 rounded-md bg-white/10 px-2.5 text-[12.5px] font-semibold transition-[background-color,transform] duration-150 ease-out hover:bg-white/16 focus-visible:ring-2 focus-visible:ring-[#f5a524] focus-visible:outline-none active:scale-[0.97]"
        >
          Retry now
        </button>
      )}
    </div>
  );
}

function DriverList({
  status,
  drivers,
  unit,
  selectedId,
  onPick,
}: {
  status: LiveStatus;
  drivers: LiveDriver[];
  unit: "km" | "mi";
  selectedId: string | null;
  onPick: (driverId: string) => void;
}) {
  if (status === "connecting") {
    return (
      <div className="space-y-2 p-3" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="h-11 animate-pulse rounded-lg bg-white/[0.06] motion-reduce:animate-none"
          />
        ))}
      </div>
    );
  }
  if (drivers.length === 0) {
    return (
      <p className="px-4 py-5 text-[13.5px] leading-relaxed text-[#a89d90]">
        {status === "lost"
          ? "The list fills in again once the connection is back."
          : "No one to list yet."}
      </p>
    );
  }
  return (
    <ul
      className={`max-h-80 min-h-0 flex-1 divide-y divide-white/[0.06] overflow-y-auto transition-opacity duration-200 lg:max-h-none ${
        status === "lost" ? "opacity-55" : ""
      }`}
    >
      {drivers.map((d) => {
        const selected = d.driverId === selectedId;
        return (
          <li key={d.driverId}>
            <button
              type="button"
              aria-pressed={selected}
              onClick={() => onPick(d.driverId)}
              className={`flex min-h-12 w-full items-center gap-3 px-4 py-2 text-left transition-colors duration-150 ease-out focus-visible:bg-white/[0.08] focus-visible:outline-none ${
                selected ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"
              }`}
            >
              <span
                aria-hidden="true"
                className={`size-2.5 shrink-0 rounded-full bg-[#f5a524] ${
                  selected ? "ring-4 ring-[#f5a524]/30" : ""
                }`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-semibold">{d.displayName}</span>
                <span className="block truncate text-[12px] text-[#a89d90]">{whereLabel(d)}</span>
              </span>
              <span className="tabular shrink-0 text-[13px] text-[#cfc5b8]">
                {formatSpeed(d.speed_kmh, unit)}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The driver's own privacy setting for the public map. */
function VisibilityToggle({ shown, inCompany }: { shown: boolean; inCompany: boolean }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const labelId = useId();
  const viewerKey = trpc.live.viewer.queryKey();
  const update = useMutation(
    trpc.driver.updateSettings.mutationOptions({
      onMutate: async ({ showOnLiveMap }) => {
        await queryClient.cancelQueries({ queryKey: viewerKey });
        const before = queryClient.getQueryData(viewerKey);
        if (before && showOnLiveMap !== undefined) {
          queryClient.setQueryData(viewerKey, { ...before, showOnLiveMap });
        }
        return { before };
      },
      onError: (_error, _input, context) => {
        if (context?.before) queryClient.setQueryData(viewerKey, context.before);
        toast.error("Couldn't save that. Try again.");
      },
      onSettled: () => queryClient.invalidateQueries({ queryKey: trpc.driver.pathKey() }),
    }),
  );

  const help = inCompany
    ? "Your company sees you while you drive either way."
    : "Off: nobody sees where you drive.";

  return (
    <div className="mt-4 flex items-center justify-between gap-5 rounded-2xl border bg-card px-5 py-4">
      <div>
        <p id={labelId} className="text-[15px] font-semibold">
          Show me on the public map
        </p>
        <p className="mt-0.5 text-[13.5px] text-muted-foreground">
          {help} A change reaches open maps within a few seconds.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={shown}
        aria-labelledby={labelId}
        onClick={() => update.mutate({ showOnLiveMap: !shown })}
        className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ease-out focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-card focus-visible:outline-none ${
          shown ? "bg-primary" : "bg-input"
        }`}
      >
        <span
          aria-hidden="true"
          className={`absolute top-0.5 left-0.5 size-6 rounded-full bg-white shadow-[0_1px_2px_rgba(29,23,18,0.25)] transition-transform duration-200 ease-out motion-reduce:transition-none ${
            shown ? "translate-x-5" : ""
          }`}
        />
      </button>
    </div>
  );
}
