import { Button } from "@te-rebrand/ui/components/button";

import { LinkPanel } from "../components/link-panel";
import type { Run, Status } from "../lib/status";

export function Settings({ status, busy, run }: { status: Status; busy: boolean; run: Run }) {
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
