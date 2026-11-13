import { Button } from "@te-rebrand/ui/components/button";
import { Checkbox } from "@te-rebrand/ui/components/checkbox";
import { useId } from "react";

import { GamesSection } from "../components/games-section";
import { LinkPanel } from "../components/link-panel";
import type { Games } from "../lib/games";
import { useAppSettings } from "../lib/settings";
import type { Run, Status } from "../lib/status";

export function Settings({
  status,
  games,
  busy,
  run,
}: {
  status: Status;
  games: Games;
  busy: boolean;
  run: Run;
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-lg font-semibold">Settings</h1>

      {status.linked ? (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Account</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Logging jobs for{" "}
              <strong className="font-semibold text-foreground">{status.driver_name}</strong>.
              Unlinking stops uploads from this PC; jobs already sent stay on your profile.
            </p>
          </div>
          <Button variant="destructive" onClick={() => run("unlink")} disabled={busy}>
            Unlink this tracker
          </Button>
        </section>
      ) : (
        <LinkPanel status={status} busy={busy} run={run} />
      )}

      <GamesSection games={games} />

      <Startup />

      {import.meta.env.DEV && (
        <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-dashed p-5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold">Development</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Plays a recorded Hamburg to Lyon delivery through the real pipeline, without the game.
            </p>
          </div>
          <Button variant="outline" onClick={() => run("start_replay")} disabled={busy}>
            Replay a delivery
          </Button>
        </section>
      )}
    </div>
  );
}

/** "Start with Windows". Off until the driver turns it on; hidden where it can't work. */
function Startup() {
  const { settings, error, saving, setStartAtLogin } = useAppSettings();
  const id = useId();

  if (settings && !settings.start_at_login_supported) return null;

  return (
    <section className="rounded-2xl border bg-card p-5">
      <h2 className="text-base font-semibold">Startup</h2>
      <div className="mt-3 flex items-start gap-3">
        <Checkbox
          id={id}
          className="mt-0.5"
          checked={settings?.start_at_login ?? false}
          disabled={!settings || saving}
          onCheckedChange={(checked) => void setStartAtLogin(checked)}
          aria-describedby={`${id}-hint`}
        />
        <div className="min-w-0">
          <label htmlFor={id} className="text-sm font-medium">
            Start Tacho with Windows
          </label>
          <p id={`${id}-hint`} className="mt-0.5 text-sm text-muted-foreground">
            Tacho starts in the tray when you sign in, without opening this window, so a delivery is
            never missed because it wasn't running.
          </p>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
