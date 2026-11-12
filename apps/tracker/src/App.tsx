import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useEffect, useState } from "react";
import "./App.css";

// Mirrors `Status` in src-tauri/src/tracking.rs.
type Status = {
  linked: boolean;
  driver_name: string | null;
  game: "ets2" | "ats" | null;
  game_problem: string | null;
  current_job: { source_city: string; destination_city: string; cargo: string } | null;
  queued: number;
  last_result: string | null;
  last_error: string | null;
  pairing: { user_code: string; verification_url: string } | null;
};

const GAME_NAMES = { ets2: "Euro Truck Simulator 2", ats: "American Truck Simulator" };

// Working screen for the tracker. The designed screens are in Figma (see DESIGN.md).
export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    invoke<Status>("get_status").then(setStatus, (e) => setError(String(e)));
    const unlisten = listen<Status>("status", (e) => setStatus(e.payload));
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  async function run(command: string) {
    setBusy(true);
    setError(null);
    try {
      await invoke(command);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!status) return <main className="container">{error ?? "Starting…"}</main>;

  return (
    <main className="container">
      <h1>Tacho</h1>

      <section>
        <h2>Account</h2>
        {status.linked ? (
          <p>
            Logging jobs for <strong>{status.driver_name}</strong>.{" "}
            <button type="button" onClick={() => run("unlink")} disabled={busy}>
              Unlink
            </button>
          </p>
        ) : status.pairing ? (
          <>
            <p>
              Your browser opened Tacho. Check that it shows this code, then click "Link tracker":
            </p>
            <p className="code">{status.pairing.user_code}</p>
            <p>
              <button
                type="button"
                onClick={() => status.pairing && void openUrl(status.pairing.verification_url)}
              >
                Open the page again
              </button>{" "}
              ·{" "}
              <button type="button" onClick={() => run("cancel_link")}>
                Cancel
              </button>
            </p>
          </>
        ) : (
          <>
            <p>Link this tracker to your Tacho account so your jobs are saved.</p>
            <button type="button" onClick={() => run("start_link")} disabled={busy}>
              Link account
            </button>
          </>
        )}
      </section>

      <section>
        <h2>Game</h2>
        <p>{status.game ? GAME_NAMES[status.game] : "Waiting for ETS2 or ATS to start."}</p>
        {status.game_problem && (
          <p role="alert" className="error">
            {status.game_problem}
          </p>
        )}
        {status.current_job && (
          <p>
            Current job: {status.current_job.source_city} to {status.current_job.destination_city},{" "}
            {status.current_job.cargo}
          </p>
        )}
      </section>

      <section>
        <h2>Uploads</h2>
        <p>
          {status.queued === 0
            ? "Nothing waiting to send."
            : `${status.queued} job${status.queued === 1 ? "" : "s"} waiting to send.`}{" "}
          {status.queued > 0 && status.linked && (
            <button type="button" onClick={() => run("retry_uploads")} disabled={busy}>
              Send now
            </button>
          )}
        </p>
        {status.last_result && <p>Last job: {status.last_result}</p>}
      </section>

      {(error ?? status.last_error) && (
        <p role="alert" className="error">
          {error ?? status.last_error}
        </p>
      )}

      {import.meta.env.DEV && (
        <section>
          <h2>Development</h2>
          <p>No game on this machine? Replay a recorded Hamburg to Lyon delivery.</p>
          <button type="button" onClick={() => run("start_replay")} disabled={busy}>
            Replay a delivery
          </button>
        </section>
      )}
    </main>
  );
}
