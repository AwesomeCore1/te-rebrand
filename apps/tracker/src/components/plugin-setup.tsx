import { Button } from "@te-rebrand/ui/components/button";
import { cn } from "@te-rebrand/ui/lib/utils";
import { CircleCheck } from "lucide-react";
import { useState } from "react";

import { gameNames, type Games } from "../lib/games";

/** What the game does after the plugin was added. Said once, right after installing. */
export function SdkNotice({ games }: { games: string }) {
  return (
    <>
      The next time {games} starts, it shows an "SDK features" notice. Choose OK there once and
      Tacho can read your deliveries. If the game is open now, restart it.
    </>
  );
}

/**
 * On the Live job view while a game Tacho found has no telemetry plugin: one
 * button that installs it. Nothing is written until the driver clicks.
 *
 * `primary` is false while another card on the view holds the amber action.
 */
export function PluginSetup({ games, primary }: { games: Games; primary: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const installed = games.report?.games.filter((g) => g.installed) ?? [];
  const missing = installed.filter((g) => g.plugin === "missing");
  const fresh = installed.filter((g) => games.fresh.includes(g.game) && g.plugin === "ours");

  async function installAll() {
    setError(null);
    for (const game of missing) {
      const failed = await games.install(game.game);
      if (failed) {
        setError(failed.message);
        return;
      }
    }
  }

  if (missing.length === 0 && fresh.length > 0) {
    return (
      <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-5">
        <div className="min-w-0 flex-1 basis-80">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <CircleCheck className="size-5 shrink-0 text-success" aria-hidden="true" />
            Plugin installed
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            <SdkNotice games={gameNames(fresh)} />
          </p>
        </div>
        <Button variant="outline" onClick={games.dismissFresh}>
          Got it
        </Button>
      </section>
    );
  }

  if (missing.length === 0) return null;

  return (
    <section
      className={cn(
        "flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-5",
        primary && "border-primary/40",
      )}
    >
      <div className="min-w-0 flex-1 basis-80">
        <h2 className="text-xl font-semibold">Install the telemetry plugin</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tacho reads your deliveries through a small open-source plugin in the game's folder.
          {missing.length === 1 ? " It goes into:" : " It goes into each of these:"}
        </p>
        <ul className="mt-2 space-y-1 text-xs">
          {missing.map((g) => (
            <li key={g.game} className="min-w-0">
              <span className="font-medium">{g.name}</span>
              <span className="block font-mono break-all text-muted-foreground select-text">
                {g.plugins_folder}
              </span>
            </li>
          ))}
        </ul>
        {error && (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <Button
        variant={primary ? "default" : "outline"}
        onClick={() => void installAll()}
        disabled={games.installing !== null}
      >
        {games.installing !== null ? "Installing…" : error ? "Try again" : "Install plugin"}
      </Button>
    </section>
  );
}
