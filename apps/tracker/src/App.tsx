import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { TachoMark } from "@te-rebrand/ui/components/brand";
import { cn } from "@te-rebrand/ui/lib/utils";
import { Settings as SettingsIcon, Truck, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import type { Status } from "./lib/status";
import { LiveJob } from "./views/live-job";
import { Settings } from "./views/settings";

type View = "live" | "settings";

export default function App() {
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState<View>("live");

  useEffect(() => {
    invoke<Status>("get_status").then(setStatus, (e) => setError(String(e)));
    const unlisten = listen<Status>("status", (e) => setStatus(e.payload));
    return () => {
      void unlisten.then((f) => f());
    };
  }, []);

  const run = useCallback(async (command: string) => {
    setBusy(true);
    setError(null);
    try {
      await invoke(command);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  if (!status) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        {error ?? "Starting…"}
      </div>
    );
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-56 shrink-0 flex-col border-r p-4">
        <div className="flex items-center gap-2 px-1 text-sm font-semibold">
          <TachoMark className="size-5" /> Tacho
        </div>
        <nav className="mt-6 space-y-1" aria-label="Tracker">
          <NavItem icon={Truck} current={view === "live"} onClick={() => setView("live")}>
            Live job
          </NavItem>
          <NavItem
            icon={SettingsIcon}
            current={view === "settings"}
            onClick={() => setView("settings")}
          >
            Settings
          </NavItem>
        </nav>
        <Account status={status} />
      </aside>

      <main className="min-w-0 flex-1 overflow-y-auto p-6">
        {error && (
          <p
            role="alert"
            className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
          >
            {error}
          </p>
        )}
        {view === "live" ? (
          <LiveJob status={status} busy={busy} run={run} />
        ) : (
          <Settings status={status} busy={busy} run={run} />
        )}
      </main>
    </div>
  );
}

function NavItem({
  icon: Icon,
  current,
  onClick,
  children,
}: {
  icon: LucideIcon;
  current: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={current ? "page" : undefined}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors duration-150",
        current
          ? "bg-secondary font-medium text-foreground"
          : "text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
      )}
    >
      <Icon className={cn("size-4", current && "text-primary")} />
      {children}
    </button>
  );
}

/** Who this tracker logs for, pinned to the bottom of the sidebar. */
function Account({ status }: { status: Status }) {
  return (
    <div className="mt-auto rounded-xl bg-secondary/70 p-3 text-xs">
      {status.linked ? (
        <>
          <div className="truncate font-semibold">{status.driver_name}</div>
          <div className="mt-1.5 flex items-center gap-1.5 text-success">
            <span className="size-1.5 rounded-full bg-success" />
            {status.queued === 0 ? "Linked, all sent" : `Linked, ${status.queued} waiting`}
          </div>
        </>
      ) : (
        <>
          <div className="font-semibold">Not linked</div>
          <div className="mt-1 text-muted-foreground">Jobs wait on this PC until you link.</div>
        </>
      )}
    </div>
  );
}
