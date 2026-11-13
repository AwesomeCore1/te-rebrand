import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@te-rebrand/ui/components/button";

import type { Run, Status } from "../lib/status";

/** Shown until the tracker is linked: the call to link, then the code to check. */
export function LinkPanel({ status, busy, run }: { status: Status; busy: boolean; run: Run }) {
  const { pairing } = status;

  if (pairing) {
    return (
      <section className="rounded-2xl border border-primary/40 bg-card p-5">
        <h2 className="text-xl font-semibold">Check the code in your browser</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Tacho opened in your browser. If it shows this code, choose "Link tracker" there.
        </p>
        <p className="tabular mt-4 font-mono text-4xl font-semibold tracking-[0.18em] select-text">
          {pairing.user_code}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openUrl(pairing.verification_url)}
          >
            Open the page again
          </Button>
          <Button variant="ghost" size="sm" onClick={() => run("cancel_link")}>
            Cancel
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-primary/40 bg-card p-5">
      <div className="min-w-0">
        <h2 className="text-xl font-semibold">Link this tracker to your account</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Your deliveries are saved to Tacho once it is linked. Until then they wait on this PC.
        </p>
      </div>
      <Button onClick={() => run("start_link")} disabled={busy}>
        Link account
      </Button>
    </section>
  );
}
