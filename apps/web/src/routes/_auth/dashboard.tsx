import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@te-rebrand/ui/components/button";
import { Skeleton } from "@te-rebrand/ui/components/skeleton";
import { Check, LogOut, Monitor, Settings2 } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { toast } from "sonner";
import { z } from "zod";

import { actionError, ConfirmAction, roleLabel } from "@/components/company/bits";
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
  const steamLinked = Boolean(driver.steamId64);
  // Something is still missing before every delivery counts where it should.
  const newDriver = !steamLinked || !company || !hasTracker || totals.allTimeJobs === 0;
  // Nothing driven yet: the next steps stand in for the number and job panels.
  const nothingYet = totals.allTimeJobs === 0 && recentJobs.length === 0;

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
          steamLinked={steamLinked}
          inCompany={Boolean(company)}
          hasTracker={hasTracker}
          hasJob={totals.allTimeJobs > 0}
        />
      )}

      {!nothingYet && (
        <section
          className="tabular grid grid-cols-2 gap-3 md:grid-cols-4"
          aria-label="Your numbers"
        >
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
      )}

      {(!nothingYet || company) && (
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
                    <Link
                      to="/jobs/$jobId"
                      params={{ jobId: j.id }}
                      className="block truncate text-[15px] font-semibold underline-offset-4 hover:underline"
                    >
                      {j.sourceCity} <span className="text-signal-ink">→</span> {j.destCity}
                    </Link>
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
      )}

      <ConvoyColumns convoys={convoys} />

      <AccountSection steamId={driver.steamId64} company={company} />
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
    ? null
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
    <section
      aria-label="Convoys"
      className={`grid grid-cols-[minmax(0,1fr)] gap-6 ${own ? "md:grid-cols-2" : ""}`}
    >
      {/* No company, no first column: an empty panel says nothing a step above doesn't. */}
      {own && (
        <Card title={`${own.name} convoys`} empty={ownEmpty}>
          <ul className="divide-y">
            {own.events.map((e) => (
              <li key={e.id}>
                <ConvoyRow convoy={e} />
              </li>
            ))}
          </ul>
        </Card>
      )}
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

/**
 * The Figma "new driver" state: what's left before kilometres start counting,
 * each step with the one thing to do next. The first open step has the amber
 * button; the page's other buttons stay quiet.
 */
function GetOnTheRoad(props: {
  steamLinked: boolean;
  inCompany: boolean;
  hasTracker: boolean;
  hasJob: boolean;
}) {
  const steps: {
    done: boolean;
    title: string;
    body: string;
    action?: (primary: boolean) => ReactNode;
  }[] = [
    {
      done: props.steamLinked,
      title: "Connect Steam",
      body: "It's how Tacho finds you on TruckersMP and checks which VTC you're in.",
      action: (primary) => (
        // A plain link: a full-page redirect to Steam, not an API call.
        <a href="/api/steam/connect">
          <Button variant={primary ? "default" : "outline"}>Connect Steam</Button>
        </a>
      ),
    },
    {
      done: props.hasTracker,
      title: "Install and link the tracker",
      body: "Windows 10 and 11. Install it, choose Link account, and confirm the code it shows. Then it sits in the tray and logs every delivery.",
      action: (primary) => (
        <div className="flex flex-wrap gap-2">
          <Link to="/download">
            <Button variant={primary ? "default" : "outline"}>Get the tracker</Button>
          </Link>
          <Link to="/tracker/link">
            <Button variant="outline">Enter the tracker's code</Button>
          </Link>
        </div>
      ),
    },
    {
      done: props.inCompany,
      title: "Create or join a company",
      body: props.steamLinked
        ? "Tacho looks up your VTC on TruckersMP: register it if you own it, or apply if it's already here. Driving solo works too."
        : "Once Steam is connected, Tacho looks up your VTC on TruckersMP: register it if you own it, or apply if it's already here. Driving solo works too.",
      action: (primary) => (
        <Link to="/vtc/new">
          <Button variant={primary ? "default" : "outline"}>Find your VTC</Button>
        </Link>
      ),
    },
    {
      done: props.hasJob,
      title: "Finish your first delivery",
      body: "Any job in ETS2 or ATS counts, on TruckersMP or in singleplayer.",
    },
  ];
  const left = steps.filter((s) => !s.done).length;
  const next = steps.findIndex((s) => !s.done && s.action);
  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <div className="border-b px-5 py-4">
        <h2 className="text-xl font-bold">Get on the road</h2>
        <p className="mt-1 text-[15px] text-muted-foreground">
          {left === 1 ? "One step left" : `${left} steps left`} before every kilometre counts.
        </p>
      </div>
      <ol className="divide-y">
        {steps.map((s, i) => (
          <li key={s.title} className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4">
            <div className="flex min-w-0 flex-1 basis-72 gap-3.5">
              {s.done ? (
                <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-success-bg text-success">
                  <Check className="size-3.5" strokeWidth={3} aria-hidden="true" />
                </span>
              ) : (
                <span
                  className="tabular mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[13px] font-bold"
                  aria-hidden="true"
                >
                  {i + 1}
                </span>
              )}
              <div className="min-w-0">
                <div
                  className={`text-[15px] font-semibold ${s.done ? "text-muted-foreground" : ""}`}
                >
                  {s.title}
                  {s.done && <span className="font-normal"> · done</span>}
                </div>
                {!s.done && (
                  <p className="mt-0.5 max-w-xl text-[14px] leading-relaxed text-muted-foreground">
                    {s.body}
                  </p>
                )}
              </div>
            </div>
            {!s.done && s.action && <div className="pl-[38px] sm:pl-0">{s.action(i === next)}</div>}
          </li>
        ))}
      </ol>
    </section>
  );
}

type DashboardCompany = {
  id: string;
  name: string;
  slug: string;
  role: "owner" | "manager" | "driver";
};

/** Your company: where it lives, the admin for those who run it, and the way out. */
function CompanyCard({ company }: { company: DashboardCompany }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const leave = useMutation(
    trpc.memberships.leave.mutationOptions({
      onSuccess: () => {
        toast.success(`You left ${company.name}.`);
        return queryClient.invalidateQueries();
      },
      onError: (e) => toast.error(actionError(e)),
    }),
  );

  const runsIt = company.role !== "driver";
  return (
    <Card title="Company">
      <div className="space-y-4 p-5">
        <p className="text-[15px] leading-relaxed">
          <span className="font-semibold">{company.name}</span>
          <span className="text-muted-foreground">
            {" "}
            · {roleLabel(company.role)}
            {company.role === "owner" ? ". The owner can't leave yet." : ""}
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Link to="/vtc/$slug" params={{ slug: company.slug }}>
            <Button variant="outline">Company page</Button>
          </Link>
          {runsIt && (
            <Link to="/vtc/$slug/admin" params={{ slug: company.slug }}>
              <Button variant="outline">
                <Settings2 /> Admin
              </Button>
            </Link>
          )}
        </div>
        {company.role !== "owner" && (
          <ConfirmAction
            variant="ghost"
            label="Leave company"
            icon={<LogOut />}
            question={`Leave ${company.name}?`}
            detail="Your past deliveries stay with the company. To come back you apply again."
            confirmLabel="Leave"
            pendingLabel="Leaving…"
            pending={leave.isPending}
            onConfirm={() => leave.mutate({ companyId: company.id })}
          />
        )}
      </div>
    </Card>
  );
}

function AccountSection({
  steamId,
  company,
}: {
  steamId: string | null;
  company: DashboardCompany | null;
}) {
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
    <div className={`grid gap-6 md:grid-cols-2 ${company ? "lg:grid-cols-3" : ""}`}>
      {/* Without a company, "Create or join a company" above is the way in. */}
      {company && <CompanyCard company={company} />}
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
                <Button variant="outline">Connect Steam</Button>
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
