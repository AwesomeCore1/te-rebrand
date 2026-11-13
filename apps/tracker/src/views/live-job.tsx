import { Button } from "@te-rebrand/ui/components/button";
import { GameBadge } from "@te-rebrand/ui/components/brand";
import { cn } from "@te-rebrand/ui/lib/utils";
import { ArrowRight, Pause, Radio } from "lucide-react";

import { LinkPanel } from "../components/link-panel";
import { PluginSetup } from "../components/plugin-setup";
import {
  formatIncome,
  formatKm,
  formatMiles,
  formatNumber,
  formatPercent,
  formatTonnes,
} from "../lib/format";
import type { Games } from "../lib/games";
import type { Game, JobInfo, Live, Run, Status } from "../lib/status";

export function LiveJob({
  status,
  games,
  busy,
  run,
  openSettings,
}: {
  status: Status;
  games: Games;
  busy: boolean;
  run: Run;
  openSettings: () => void;
}) {
  const { game, live, current_job: job } = status;
  const report = games.report;
  // Windows, but neither game is in a Steam library: nothing to install into.
  const noGameFound = report?.supported === true && !report.games.some((g) => g.installed);
  // The game runs with a plugin Tacho can't read, and it is not the one Tacho ships.
  const foreignPlugin =
    report?.games.some((g) => g.plugin === "different" || g.plugin === "unreadable") ?? false;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Live job</h1>
        <div className="flex flex-wrap items-center gap-1.5">
          {game && <GameBadge game={game === "ets2" ? "ETS2" : "ATS"} />}
          {game && live && <Pill>{live.multiplayer ? "TruckersMP" : "Singleplayer"}</Pill>}
          <TrackingPill game={game} live={live} />
        </div>
      </header>

      {status.game_problem && (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
        >
          <p className="min-w-0 flex-1 basis-80">{status.game_problem}</p>
          {foreignPlugin && (
            <Button variant="outline" size="sm" className="text-foreground" onClick={openSettings}>
              Replace it in Settings
            </Button>
          )}
        </div>
      )}

      {!status.linked && <LinkPanel status={status} busy={busy} run={run} />}

      {/* One amber action per view: linking comes first, then the plugin. */}
      <PluginSetup games={games} primary={status.linked} />

      <section className="rounded-2xl border bg-card p-5">
        {job && game ? (
          <Job job={job} game={game} live={live} />
        ) : (
          <div className="py-6">
            <h2 className="text-xl font-semibold">
              {game ? "No job right now" : "Waiting for ETS2 or ATS"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {game
                ? "Take a job in the game. It shows up here as soon as you drive off."
                : "Start the game and Tacho picks it up on its own. You can leave this window closed."}
            </p>
            {!game && noGameFound && (
              <p className="mt-3 text-sm text-muted-foreground">
                Tacho did not find ETS2 or ATS in Steam on this PC.{" "}
                <button
                  type="button"
                  onClick={openSettings}
                  className="rounded-sm font-medium text-signal-ink underline-offset-4 hover:underline"
                >
                  See Games in Settings
                </button>
              </p>
            )}
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 gap-4">
        <section className="rounded-2xl border bg-card p-4">
          <h2 className="font-sans text-xs font-normal tracking-normal text-muted-foreground">
            Waiting to send
          </h2>
          <div className="mt-1 flex items-center justify-between gap-3">
            <p className="tabular text-lg font-semibold">
              {status.queued === 0
                ? "Nothing"
                : `${status.queued} job${status.queued === 1 ? "" : "s"}`}
            </p>
            {status.queued > 0 && status.linked && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => run("retry_uploads")}
                disabled={busy}
              >
                Send now
              </Button>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {status.queued === 0
              ? "Finished jobs are sent right away."
              : status.linked
                ? "Kept on this PC and sent when Tacho can be reached."
                : "Kept on this PC until you link your account."}
          </p>
        </section>

        <section className="rounded-2xl border bg-card p-4">
          <h2 className="font-sans text-xs font-normal tracking-normal text-muted-foreground">
            Last job sent
          </h2>
          <p className="mt-1 text-sm font-medium">
            {status.last_result ?? "None from this PC yet."}
          </p>
          {status.last_error && (
            <p role="alert" className="mt-1 text-xs text-destructive">
              {status.last_error}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}

function Job({ job, game, live }: { job: JobInfo; game: Game; live: Live | null }) {
  const driven = live?.driven_km ?? null;
  const planned = job.planned_distance_km;
  const share = driven !== null && planned > 0 ? Math.min(driven / planned, 1) : null;
  const companies = [job.source_company, job.destination_company].filter(Boolean).join(" to ");

  return (
    <>
      <h2 className="flex flex-wrap items-center gap-x-2.5 text-3xl font-semibold">
        {job.source_city}
        <ArrowRight className="size-6 text-primary" aria-label="to" />
        {job.destination_city}
      </h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        {companies && `${companies} · `}
        {job.cargo}, {formatTonnes(job.cargo_mass_kg)}
      </p>

      {share !== null && driven !== null && (
        <>
          <div
            className="mt-5 h-2 overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-label="Distance driven"
            aria-valuemin={0}
            aria-valuemax={Math.round(planned)}
            aria-valuenow={Math.round(Math.min(driven, planned))}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-700 ease-out"
              style={{ width: `${share * 100}%` }}
            />
          </div>
          <div className="tabular mt-2 flex flex-wrap justify-between gap-x-4 text-xs">
            <span>
              {formatKm(driven)} driven ({formatMiles(driven)})
            </span>
            <span className="text-muted-foreground">
              {formatKm(planned)} planned · {formatNumber(Math.max(planned - driven, 0))} km left
            </span>
          </div>
        </>
      )}

      <dl className="tabular mt-5 grid grid-cols-4 gap-y-4 border-t pt-4">
        <Reading label="Speed" value={live ? `${formatNumber(live.speed_kmh)} km/h` : "–"} />
        <Reading label="Cargo damage" value={live ? formatPercent(live.cargo_damage) : "–"} />
        <Reading label="Planned" value={planned > 0 ? formatKm(planned) : "–"} />
        <Reading label="Income" value={formatIncome(job.income, game)} />
      </dl>
    </>
  );
}

function Reading({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-base font-semibold">{value}</dd>
    </div>
  );
}

function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-full bg-secondary px-2 text-[11px] text-secondary-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}

function TrackingPill({ game, live }: { game: Game | null; live: Live | null }) {
  if (!game) return <Pill className="text-muted-foreground">Waiting for the game</Pill>;
  if (live?.paused) {
    return (
      <Pill>
        <Pause className="size-3" /> Paused
      </Pill>
    );
  }
  return (
    <Pill className="bg-success-bg font-semibold text-success">
      <Radio className="size-3" /> Tracking
    </Pill>
  );
}
