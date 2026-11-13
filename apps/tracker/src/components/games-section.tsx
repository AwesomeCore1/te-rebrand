import { GameBadge } from "@te-rebrand/ui/components/brand";
import { Button } from "@te-rebrand/ui/components/button";
import { Skeleton } from "@te-rebrand/ui/components/skeleton";
import { cn } from "@te-rebrand/ui/lib/utils";
import { RefreshCw } from "lucide-react";
import { useState } from "react";

import type { GameReport, Games } from "../lib/games";
import { SdkNotice } from "./plugin-setup";

/** Settings: each game Tacho knows, where it is, and its telemetry plugin. */
export function GamesSection({ games }: { games: Games }) {
  const { report, error } = games;
  const [checking, setChecking] = useState(false);

  async function checkAgain() {
    setChecking(true);
    await games.refresh();
    setChecking(false);
  }

  return (
    <section className="rounded-2xl border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 basis-80">
          <h2 className="text-base font-semibold">Games</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Tacho reads the game through a telemetry plugin, one file in each game's folder: the
            open-source RenCloud scs-sdk-plugin
            {report ? `, release ${report.plugin_release}` : ""}.
          </p>
        </div>
        {report?.supported !== false && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void checkAgain()}
            disabled={checking || games.installing !== null}
          >
            <RefreshCw className={cn(checking && "animate-spin motion-reduce:animate-none")} />
            Check again
          </Button>
        )}
      </div>

      {error ? (
        <p role="alert" className="mt-4 border-t pt-4 text-sm text-destructive">
          Couldn't check your games: {error}
        </p>
      ) : !report ? (
        <div className="mt-4 divide-y border-t" aria-busy="true" aria-label="Checking your games">
          {[0, 1].map((row) => (
            <div key={row} className="flex items-center justify-between gap-4 py-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-3 w-72" />
              </div>
              <Skeleton className="h-8 w-28" />
            </div>
          ))}
        </div>
      ) : !report.supported ? (
        <p className="mt-4 border-t pt-4 text-sm text-muted-foreground">
          Game telemetry is Windows-only. On this computer Tacho can't read ETS2 or ATS, so there is
          nothing to install here.
        </p>
      ) : !report.steam_found ? (
        <p className="mt-4 border-t pt-4 text-sm text-muted-foreground">
          Steam was not found on this PC. Tacho looks for ETS2 and ATS in your Steam libraries.
          Install the game through Steam, then check again.
        </p>
      ) : (
        <ul className="mt-4 divide-y border-t">
          {report.games.map((game) => (
            <GameRow key={game.game} game={game} games={games} />
          ))}
        </ul>
      )}
    </section>
  );
}

function GameRow({ game, games }: { game: GameReport; games: Games }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = games.installing !== null;
  const fresh = games.fresh.includes(game.game) && game.plugin === "ours";

  async function install(replace: boolean) {
    setError(null);
    const failed = await games.install(game.game, replace);
    if (failed?.kind === "needs_confirmation") {
      // The file changed since the last check: ask before replacing it.
      setConfirming(true);
      void games.refresh();
      return;
    }
    setConfirming(false);
    if (failed) setError(failed.message);
  }

  const foreign = game.plugin === "different" || game.plugin === "unreadable";

  return (
    <li className="py-4 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-72">
          <div className="flex flex-wrap items-center gap-2">
            <GameBadge game={game.game === "ets2" ? "ETS2" : "ATS"} />
            <span className="text-sm font-medium">{game.name}</span>
            <PluginPill game={game} />
          </div>
          <p className="mt-1 font-mono text-xs break-all text-muted-foreground select-text">
            {game.installed ? game.folder : "Not found in your Steam libraries."}
          </p>
        </div>

        {game.installed && !confirming && (
          <>
            {game.plugin === "missing" && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => void install(false)}
                disabled={busy}
              >
                {games.installing === game.game ? "Installing…" : "Install plugin"}
              </Button>
            )}
            {game.plugin === "ours" && (
              <Button variant="ghost" size="sm" onClick={() => void install(false)} disabled={busy}>
                {games.installing === game.game ? "Installing…" : "Reinstall"}
              </Button>
            )}
            {foreign && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setError(null);
                  setConfirming(true);
                }}
                disabled={busy}
              >
                Replace
              </Button>
            )}
          </>
        )}
      </div>

      {foreign && !confirming && (
        <p className="mt-2 text-xs text-muted-foreground">
          {game.plugin === "different"
            ? "There is a scs-telemetry.dll here that is not the one Tacho ships. Another tool may have put it there. Tacho can only read its own release."
            : "There is a scs-telemetry.dll here that Tacho can't open, so it can't tell whose it is."}
        </p>
      )}

      {confirming && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="min-w-0 flex-1 basis-72 text-sm">
            Replace the scs-telemetry.dll in this game's plugins folder with Tacho's? A tool that
            relies on the current file may stop working.
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirming(false)} disabled={busy}>
              Keep it
            </Button>
            <Button variant="outline" size="sm" onClick={() => void install(true)} disabled={busy}>
              {games.installing === game.game ? "Replacing…" : "Replace file"}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {fresh && !error && (
        <p className="mt-2 text-xs text-muted-foreground" role="status">
          <SdkNotice games={game.name} />
        </p>
      )}
    </li>
  );
}

function PluginPill({ game }: { game: GameReport }) {
  if (!game.installed || !game.plugin) {
    return <Pill className="text-muted-foreground">Not installed</Pill>;
  }
  switch (game.plugin) {
    case "ours":
      return <Pill className="bg-success-bg font-semibold text-success">Plugin installed</Pill>;
    case "missing":
      return <Pill>Plugin missing</Pill>;
    case "different":
      return <Pill className="text-signal-ink">Different plugin</Pill>;
    case "unreadable":
      return <Pill className="text-signal-ink">Plugin can't be read</Pill>;
  }
}

function Pill({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full bg-secondary px-2 text-[11px] text-secondary-foreground",
        className,
      )}
    >
      {children}
    </span>
  );
}
