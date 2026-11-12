import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@te-rebrand/ui/components/button";
import { Skeleton } from "@te-rebrand/ui/components/skeleton";
import { Check, Monitor } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { type ConvoyListItem, ConvoyRow } from "@/components/convoy-row";
import { GameBadge } from "@/components/landing/bits";
import { formatDistance, formatIncome, formatWhen } from "@/lib/format";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/_auth/dashboard")({
  validateSearch: z.object({ steam: z.enum(["linked", "failed", "taken"]).optional() }),
  component: Dashboard,
});

const STEAM_MESSAGES = {
  linked: () => toast.success("Steam linked."),
  failed: () => toast.error("Steam didn't confirm the sign-in. Try again."),
  taken: () => toast.error("That Steam account is already linked to another driver."),
};

type Unit = "km" | "mi";

function Dashboard() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = Route.useNavigate();
  const { steam } = Route.useSearch();

  useEffect(() => {
    if (!steam) return;
    STEAM_MESSAGES[steam]();
    void navigate({ search: {}, replace: true });
  }, [steam, navigate]);

  const dash = useQuery(trpc.driver.dashboard.queryOptions());
  const updateSettings = useMutation(
    trpc.driver.updateSettings.mutationOptions({
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: trpc.driver.dashboard.queryKey() }),
    }),
  );

  if (dash.isError) {
    return (
      <Page>
        <p className="text-destructive">Couldn't load your dashboard. Reload the page.</p>
      </Page>
    );
  }
  if (!dash.data) return <DashboardSkeleton />;

  const { driver, company, totals, perGame, recentJobs, hasTracker, convoys } = dash.data;
  const unit = driver.unitPreference;
  const d = (km: number) => formatDistance(km, unit);
  const topGame = [...perGame].sort((a, b) => b.km - a.km)[0];
  const newDriver = !company || !hasTracker || totals.allTimeJobs === 0;

  return (
    <Page>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[clamp(2rem,4vw,2.75rem)] leading-none font-extrabold">
            {totals.allTimeJobs > 0 ? "Welcome back" : "Welcome"}, {driver.displayName}
          </h1>
          <p className="mt-2 text-[15px] text-muted-foreground">
            {company
              ? [company.name, company.role, company.rank?.current?.name]
                  .filter(Boolean)
                  .join(" · ")
              : "Not in a company yet"}
          </p>
        </div>
        <div className="flex rounded-lg border bg-card p-1" role="group" aria-label="Distance unit">
          {(["km", "mi"] as const).map((u) => (
            <button
              key={u}
              type="button"
              aria-pressed={unit === u}
              onClick={() => updateSettings.mutate({ unitPreference: u })}
              className={`h-8 rounded-md px-3 text-sm font-semibold transition-colors ${
                unit === u
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {u}
            </button>
          ))}
        </div>
      </header>

      {newDriver && (
        <GetOnTheRoad
          steamLinked={Boolean(driver.steamId64)}
          inCompany={Boolean(company)}
          hasTracker={hasTracker}
          hasJob={totals.allTimeJobs > 0}
        />
      )}

      <section className="tabular grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Your numbers">
        <Stat label="This month" value={d(totals.monthKm)} sub={`${totals.monthJobs} jobs`} />
        <Stat label="All time" value={d(totals.allTimeKm)} sub={`${totals.allTimeJobs} jobs`} />
        <Stat
          label="Most driven"
          value={topGame ? (topGame.game === "ets2" ? "ETS2" : "ATS") : "None yet"}
          sub={
            [...perGame]
              .sort((a, b) => b.km - a.km)
              .map((g) => `${g.game.toUpperCase()} ${d(g.km)}`)
              .join(" · ") || "Drive a job to start"
          }
        />
        <RankStat rank={company?.rank ?? null} unit={unit} />
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Card
          title="Recent jobs"
          className="min-w-0 lg:self-start"
          empty={
            recentJobs.length === 0
              ? "No jobs yet. Finish a delivery in ETS2 or ATS with the tracker running."
              : null
          }
        >
          <ul className="divide-y">
            {recentJobs.map((j) => (
              <li key={j.id} className="flex items-center gap-3 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] font-semibold">
                    {j.sourceCity} <span className="text-signal-ink">→</span> {j.destCity}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                    <GameBadge game={j.game === "ets2" ? "ETS2" : "ATS"} />
                    <span>
                      {j.cargo}, {(j.cargoMassKg / 1000).toFixed(1)} t
                    </span>
                    {j.multiplayer && <span>· TruckersMP</span>}
                    <span>· {formatWhen(j.finishedAt)}</span>
                  </div>
                </div>
                <div className="tabular shrink-0 text-right">
                  <div className="text-[15px] font-semibold">{d(j.drivenKm)}</div>
                  <div className="mt-0.5 flex items-center justify-end gap-2 text-[13px]">
                    <span className="hidden text-muted-foreground sm:inline">
                      {formatIncome(j.income, j.game)}
                    </span>
                    <StatusPill status={j.status} reasons={j.flagReasons} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </Card>

        <div className="min-w-0 space-y-6">
          {company?.goal && <GoalCard goal={company.goal} unit={unit} />}
          {company?.leaderboard && (
            <LeaderboardCard board={company.leaderboard} unit={unit} companyName={company.name} />
          )}
        </div>
      </div>

      <ConvoyColumns convoys={convoys} />

      <AccountSection steamId={driver.steamId64} />
    </Page>
  );
}

function Page({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-5 pt-28 pb-16 md:px-8">{children}</main>
  );
}

function DashboardSkeleton() {
  return (
    <Page>
      <Skeleton className="h-10 w-72" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    </Page>
  );
}

function Card({
  title,
  action,
  children,
  empty,
  className,
}: {
  title: string;
  action?: ReactNode;
  children?: ReactNode;
  empty?: string | null;
  className?: string;
}) {
  return (
    <section className={`overflow-hidden rounded-2xl border bg-card ${className ?? ""}`}>
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3.5">
        <h2 className="text-[17px] font-bold tracking-tight">{title}</h2>
        {action}
      </div>
      {empty ? <p className="px-5 py-8 text-[15px] text-muted-foreground">{empty}</p> : children}
    </section>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card p-4">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-xl font-semibold md:text-2xl">{value}</div>
      <div className="mt-0.5 truncate text-[13px] text-muted-foreground">{sub}</div>
    </div>
  );
}

type Rank = { name: string; minKm: number };
function RankStat({
  rank,
  unit,
}: {
  rank: { kmInCompany: number; current: Rank | null; next: Rank | null } | null;
  unit: Unit;
}) {
  if (!rank) return <Stat label="Rank" value="None" sub="Ranks come with a company" />;
  const { kmInCompany: km, current, next } = rank;
  const from = current?.minKm ?? 0;
  const pct = next ? Math.min(100, ((km - from) / (next.minKm - from)) * 100) : 100;
  return (
    <div className="min-w-0 rounded-2xl border bg-card p-4">
      <div className="text-[13px] text-muted-foreground">Rank</div>
      <div className="mt-1 truncate text-xl font-semibold md:text-2xl">
        {current?.name ?? "Unranked"}
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 truncate text-[13px] text-muted-foreground">
        {next ? `${formatDistance(next.minKm - km, unit)} to ${next.name}` : "Top rank"}
      </div>
    </div>
  );
}

function StatusPill({ status, reasons }: { status: string; reasons: string[] }) {
  const style =
    status === "delivered"
      ? "bg-success-bg text-success"
      : status === "flagged"
        ? "bg-destructive/12 text-destructive"
        : "bg-secondary text-muted-foreground";
  return (
    <span
      className={`inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold ${style}`}
      title={status === "flagged" ? `Flagged for review: ${reasons.join(", ")}` : undefined}
    >
      {status}
    </span>
  );
}

function GoalCard({
  goal,
  unit,
}: {
  goal: {
    title: string;
    metric: "km" | "jobs" | "income";
    target: number;
    done: number;
    yours: number;
    startAt: Date | string;
  };
  unit: Unit;
}) {
  const pct = Math.min(100, (goal.done / goal.target) * 100);
  const fmt = (n: number) =>
    goal.metric === "km"
      ? formatDistance(n, unit)
      : goal.metric === "jobs"
        ? `${n} jobs`
        : `€ ${Math.round(n)}`;
  const month = new Date(goal.startAt).toLocaleDateString("en-GB", {
    month: "long",
    timeZone: "UTC",
  });
  return (
    <Card title={`Company goal · ${month}`}>
      <div className="p-5">
        <div className="font-display text-xl font-bold">{goal.title}</div>
        <div className="mt-3 h-2.5 overflow-hidden rounded-full bg-secondary">
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <div className="tabular mt-2 text-[13px]">
          <span className="font-semibold">
            {fmt(goal.done)} · {Math.round(pct)} %
          </span>
          <span className="text-muted-foreground"> · your share: {fmt(goal.yours)}</span>
        </div>
      </div>
    </Card>
  );
}

type ConvoyList = { events: ConvoyListItem[]; unavailable: boolean };
const UNAVAILABLE = "Couldn't reach TruckersMP right now. Convoys will be back shortly.";

/**
 * Two columns side by side: convoys your company created, and convoys created
 * by the other VTCs on Tacho. Both come from TruckersMP.
 */
function ConvoyColumns({
  convoys,
}: {
  convoys: {
    company: (ConvoyList & { name: string; hasVtcId: boolean }) | null;
    tacho: ConvoyList;
  };
}) {
  const own = convoys.company;
  const ownEmpty = !own
    ? "Join a VTC to see its convoys here."
    : !own.hasVtcId
      ? `${own.name} has no TruckersMP VTC ID yet. Add it to show the convoys you create on TruckersMP.`
      : own.unavailable
        ? UNAVAILABLE
        : own.events.length === 0
          ? `${own.name} has no upcoming convoys on TruckersMP.`
          : null;
  const tachoEmpty = convoys.tacho.unavailable
    ? UNAVAILABLE
    : convoys.tacho.events.length === 0
      ? "No other VTC on Tacho has a convoy planned yet."
      : null;

  return (
    <section aria-label="Convoys" className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-2">
      <Card title={own ? `${own.name} convoys` : "Your VTC's convoys"} empty={ownEmpty}>
        <ul className="divide-y">
          {own?.events.map((e) => (
            <li key={e.id}>
              <ConvoyRow convoy={e} />
            </li>
          ))}
        </ul>
      </Card>
      <Card
        title="Convoys on Tacho"
        empty={tachoEmpty}
        action={
          <Link
            to="/events"
            className="rounded-md text-[13px] font-medium text-signal-ink underline-offset-2 hover:underline"
          >
            All convoys
          </Link>
        }
      >
        <ul className="divide-y">
          {convoys.tacho.events.map((e) => (
            <li key={e.id}>
              <ConvoyRow convoy={e} showHost />
            </li>
          ))}
        </ul>
      </Card>
    </section>
  );
}

function LeaderboardCard({
  board,
  unit,
  companyName,
}: {
  board: {
    rows: { place: number; driverId: string; displayName: string; km: number; you: boolean }[];
    you: { place: number; km: number } | null;
  };
  unit: Unit;
  companyName: string;
}) {
  const month = new Date().toLocaleDateString("en-GB", { month: "long" });
  return (
    <Card
      title={`Leaderboard · ${month}`}
      empty={board.rows.length === 0 ? `No deliveries in ${companyName} this month yet.` : null}
    >
      <ol className="tabular divide-y text-[14px]">
        {board.rows.map((r) => (
          <li
            key={r.driverId}
            className={`flex items-center gap-3 px-5 py-2.5 ${r.you ? "bg-[var(--row-highlight)]" : ""}`}
          >
            <span className="w-4 text-muted-foreground">{r.place}</span>
            <span className="min-w-0 flex-1 truncate font-semibold">
              {r.displayName}
              {r.you && <span className="font-normal text-muted-foreground"> (you)</span>}
            </span>
            <span className="font-semibold">{formatDistance(r.km, unit)}</span>
          </li>
        ))}
        {board.you && (
          <li className="flex items-center gap-3 bg-[var(--row-highlight)] px-5 py-2.5">
            <span className="w-4 text-muted-foreground">{board.you.place}</span>
            <span className="flex-1 font-semibold">You</span>
            <span className="font-semibold">{formatDistance(board.you.km, unit)}</span>
          </li>
        )}
      </ol>
    </Card>
  );
}

/** The Figma "new driver" state: what's left before kilometres start counting. */
function GetOnTheRoad(props: {
  steamLinked: boolean;
  inCompany: boolean;
  hasTracker: boolean;
  hasJob: boolean;
}) {
  const steps = [
    {
      done: props.steamLinked,
      title: "Link Steam",
      body: "So we can find your TruckersMP profile and check your VTC.",
    },
    {
      done: props.inCompany,
      title: "Join a VTC",
      body: "Apply to your company, or keep tracking solo.",
    },
    {
      done: props.hasTracker,
      title: "Install the tracker",
      body: "Windows 10 and 11. It sits in the tray and logs every delivery.",
    },
    {
      done: props.hasJob,
      title: "Finish your first delivery",
      body: "Any job in ETS2 or ATS counts.",
    },
  ];
  const left = steps.filter((s) => !s.done).length;
  return (
    <section className="rounded-2xl border bg-card p-5 md:p-6">
      <h2 className="text-xl font-bold">Get on the road</h2>
      <p className="mt-1 text-[15px] text-muted-foreground">
        {left === 1 ? "One step left" : `${left} steps left`} before your kilometres start counting.
      </p>
      <ol className="mt-4 grid gap-3 md:grid-cols-4">
        {steps.map((s, i) => (
          <li key={s.title} className={`rounded-xl border p-4 ${s.done ? "opacity-60" : ""}`}>
            <div className="flex items-center gap-2 text-[15px] font-semibold">
              {s.done ? (
                <span className="flex size-5 items-center justify-center rounded-full bg-success-bg text-success">
                  <Check className="size-3" strokeWidth={3} />
                </span>
              ) : (
                <span className="tabular text-signal-ink">{i + 1}</span>
              )}
              {s.title}
            </div>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{s.body}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function AccountSection({ steamId }: { steamId: string | null }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const devices = useQuery(trpc.tracker.devices.queryOptions());
  const revoke = useMutation(
    trpc.tracker.revokeDevice.mutationOptions({
      onSuccess: () => {
        toast.success("Tracker unlinked.");
        void queryClient.invalidateQueries({ queryKey: trpc.tracker.devices.queryKey() });
        return queryClient.invalidateQueries({ queryKey: trpc.driver.dashboard.queryKey() });
      },
    }),
  );

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card title="Steam">
        <div className="p-5">
          {steamId ? (
            <p className="text-[15px] text-muted-foreground">
              Linked: SteamID64 <span className="tabular text-foreground">{steamId}</span>
            </p>
          ) : (
            <div className="space-y-3">
              <p className="text-[15px] text-muted-foreground">
                Link Steam so we can find your TruckersMP profile and check your VTC.
              </p>
              {/* A plain link: a full-page redirect to Steam, not an API call. */}
              <a href="/api/steam/connect">
                <Button>Connect Steam</Button>
              </a>
            </div>
          )}
        </div>
      </Card>
      <Card
        title="Linked trackers"
        empty={
          devices.isError
            ? "Couldn't load trackers."
            : devices.data?.length === 0
              ? 'None yet. Open the tracker app and choose "Link account".'
              : null
        }
      >
        {devices.isPending ? (
          <div className="p-5">
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <ul className="divide-y">
            {devices.data?.map((dv) => (
              <li key={dv.id} className="flex items-center gap-3 px-5 py-3">
                <Monitor className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 text-[14px]">
                  <div className="truncate font-semibold">{dv.name}</div>
                  <div className="truncate text-[13px] text-muted-foreground">
                    {dv.appVersion ? `v${dv.appVersion}` : "Unknown version"}
                    {dv.lastSeenAt ? ` · seen ${formatWhen(dv.lastSeenAt)}` : ""}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate({ deviceId: dv.id })}
                >
                  Unlink
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
