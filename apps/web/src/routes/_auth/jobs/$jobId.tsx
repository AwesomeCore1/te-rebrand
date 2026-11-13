import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { AppRouter } from "@te-rebrand/api/routers/index";
import { Button } from "@te-rebrand/ui/components/button";
import { Skeleton } from "@te-rebrand/ui/components/skeleton";
import type { inferRouterOutputs } from "@trpc/server";
import {
  ArrowLeft,
  ArrowRight,
  Coins,
  type LucideIcon,
  Ship,
  Siren,
  TrainFront,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";

import { GameBadge } from "@/components/landing/bits";
import { describeFlag, formatDuration, jobDurationMs } from "@/lib/flag-reasons";
import { formatDistance, formatIncome, KM_PER_MILE } from "@/lib/format";
import { useTRPC } from "@/utils/trpc";

import { countEvents, describeEvent, eventsTotal, type JobEvent } from "./-events";

// One job: the route, the numbers, how it stands, and what the game charged
// on the way. Open to the driver whose job it is and to managers and owners of
// the company it counts for; to anyone else it does not exist.
export const Route = createFileRoute("/_auth/jobs/$jobId")({
  head: () => ({ meta: [{ title: "Job · Tacho" }] }),
  component: JobPage,
});

type Job = NonNullable<inferRouterOutputs<AppRouter>["jobs"]["mine"]>;
type Unit = "km" | "mi";

type Loaded =
  | { state: "loading" }
  | { state: "missing" }
  | { state: "failed" }
  | { state: "ready"; job: Job; unit: Unit; yours: boolean };

/**
 * The API has two ways to a job: `jobs.mine` (you drove it) and
 * `jobs.inCompany` (it counts for a company you manage). The second is only
 * asked when the first finds nothing and the viewer manages a company; the
 * role itself is checked on the server, which answers nothing found (or
 * refuses) for everyone else.
 */
function useJob(jobId: string): Loaded {
  const trpc = useTRPC();
  const me = useQuery(trpc.driver.me.queryOptions());
  const mine = useQuery(trpc.jobs.mine.queryOptions({ jobId }));
  const notMine = mine.data === null;
  const managed = me.data?.company && me.data.company.role !== "driver" ? me.data.company : null;
  const inCompany = useQuery(
    trpc.jobs.inCompany.queryOptions(
      { companyId: managed?.id ?? "", jobId },
      { enabled: notMine && managed !== null, retry: false },
    ),
  );

  if (me.isError || mine.isError) return { state: "failed" };
  if (!me.data || mine.data === undefined) return { state: "loading" };
  const job = mine.data ?? inCompany.data;
  if (job) {
    const yours = job.driver.id === me.data.driver.id;
    return { state: "ready", job, unit: me.data.driver.unitPreference, yours };
  }
  if (!managed || inCompany.data === null) return { state: "missing" };
  // Refused: the membership changed since `me` was loaded.
  if (inCompany.isError) {
    return { state: inCompany.error.data?.code === "FORBIDDEN" ? "missing" : "failed" };
  }
  return { state: "loading" };
}

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

/** "12 Nov 2026, 18:00 to 19:05", with the second date when the job ran past midnight. */
function formatSpan(started: Date, finished: Date) {
  const sameDay = dateFmt.format(started) === dateFmt.format(finished);
  const end = sameDay
    ? timeFmt.format(finished)
    : `${dayFmt.format(finished)}, ${timeFmt.format(finished)}`;
  return `${dateFmt.format(started)}, ${timeFmt.format(started)} to ${end}`;
}

function JobPage() {
  const { jobId } = Route.useParams();
  const loaded = useJob(jobId);

  if (loaded.state === "loading") return <JobSkeleton />;
  if (loaded.state === "ready") return <JobView {...loaded} />;
  return (
    <Page>
      <BackLink to="/dashboard">Dashboard</BackLink>
      <h1 className="mt-6 text-3xl font-extrabold">
        {loaded.state === "missing" ? "Job not found" : "This job didn't load"}
      </h1>
      <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
        {loaded.state === "missing"
          ? "There's no job at this address. A job page is open to the driver who drove it and to the managers of the company it counts for."
          : "Something went wrong on our side. Reload the page."}
      </p>
    </Page>
  );
}

function JobView({ job, unit, yours }: { job: Job; unit: Unit; yours: boolean }) {
  const d = (km: number) => formatDistance(km, unit);
  const started = new Date(job.startedAt);
  const finished = new Date(job.finishedAt);
  const speed =
    unit === "mi"
      ? `${Math.round(job.maxSpeedKmh / KM_PER_MILE)} mph`
      : `${Math.round(job.maxSpeedKmh)} km/h`;
  const companies = [job.sourceCompany, job.destCompany].filter(Boolean);
  const reviewing = !yours && job.status === "flagged" && job.company;

  return (
    <Page>
      {yours || !job.company ? (
        <BackLink to="/dashboard">Dashboard</BackLink>
      ) : (
        <BackLink to="/vtc/$slug/admin/jobs" params={{ slug: job.company.slug }}>
          Flagged jobs
        </BackLink>
      )}

      <header className="mt-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-[clamp(1.9rem,4vw,2.75rem)] leading-[1.05] font-extrabold">
            {job.sourceCity}{" "}
            <ArrowRight
              className="inline size-[0.72em] align-[-0.04em] text-signal-ink"
              aria-label="to"
            />{" "}
            {job.destCity}
          </h1>
          <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground">
            {companies.length > 0 && <>{companies.join(" to ")} · </>}
            {yours ? "Your job" : <>Driven by {job.driver.displayName}</>}
            {job.company ? (
              <>
                {" for "}
                <Link
                  to="/vtc/$slug"
                  params={{ slug: job.company.slug }}
                  className="font-semibold text-foreground underline-offset-4 hover:underline"
                >
                  {job.company.name}
                </Link>
              </>
            ) : (
              ", driven solo"
            )}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
            <GameBadge game={job.game === "ets2" ? "ETS2" : "ATS"} />
            <span>{job.multiplayer ? "TruckersMP" : "Singleplayer"}</span>
            {/* On a phone the date wraps to its own line, where a leading dot would dangle. */}
            <span className="hidden sm:inline" aria-hidden="true">
              ·
            </span>
            <span className="tabular">{formatSpan(started, finished)}</span>
          </div>
        </div>
        <StatusPill status={job.status} />
      </header>

      <StatusNote job={job} yours={yours} unit={unit}>
        {reviewing && (
          <Link to="/vtc/$slug/admin/jobs" params={{ slug: reviewing.slug }}>
            <Button variant="outline">Decide in Flagged jobs</Button>
          </Link>
        )}
      </StatusNote>

      <section className="mt-6 rounded-2xl border bg-card p-5" aria-label="The numbers">
        <dl className="tabular grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
          <Figure label="Driven" value={d(job.drivenKm)} sub={`${d(job.plannedKm)} planned`} />
          <Figure
            label="Time"
            value={formatDuration(jobDurationMs(job))}
            sub={`${timeFmt.format(started)} to ${timeFmt.format(finished)}`}
          />
          <Figure label="Top speed" value={speed} />
          <Figure label="Income" value={formatIncome(job.income, job.game)} />
          <Figure
            label="Cargo"
            value={job.cargo}
            sub={`${(job.cargoMassKg / 1000).toFixed(1)} t`}
          />
          <Figure
            label="Cargo damage"
            value={job.damagePct > 0 ? `${job.damagePct.toFixed(1)} %` : "None"}
          />
        </dl>
      </section>

      <Events events={job.events} game={job.game} />
    </Page>
  );
}

function Page({ children }: { children: ReactNode }) {
  return <main className="mx-auto w-full max-w-4xl px-5 pt-28 pb-16 md:px-8">{children}</main>;
}

function BackLink(props: {
  to: "/dashboard" | "/vtc/$slug/admin/jobs";
  params?: { slug: string };
  children: ReactNode;
}) {
  return (
    <Link
      to={props.to}
      params={props.params}
      className="inline-flex items-center gap-1.5 rounded-md text-[14px] font-semibold text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden="true" /> {props.children}
    </Link>
  );
}

function JobSkeleton() {
  return (
    <Page>
      <div aria-busy="true" aria-label="Loading the job">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="mt-6 h-11 w-2/3" />
        <Skeleton className="mt-3 h-5 w-1/2" />
        <Skeleton className="mt-8 h-40 rounded-2xl" />
        <div className="mt-6 divide-y overflow-hidden rounded-2xl border bg-card">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 px-5 py-4">
              <Skeleton className="h-5 w-10" />
              <Skeleton className="h-5 w-48 max-w-[50%]" />
              <Skeleton className="ml-auto h-5 w-16" />
            </div>
          ))}
        </div>
      </div>
    </Page>
  );
}

const STATUS: Record<Job["status"], { label: string; style: string }> = {
  delivered: { label: "Delivered", style: "bg-success-bg text-success" },
  cancelled: { label: "Cancelled", style: "bg-secondary text-muted-foreground" },
  flagged: { label: "Waiting for review", style: "bg-destructive/12 text-destructive" },
  rejected: { label: "Rejected", style: "bg-secondary text-muted-foreground" },
};

function StatusPill({ status }: { status: Job["status"] }) {
  const { label, style } = STATUS[status];
  return (
    <span
      className={`inline-flex h-7 shrink-0 items-center rounded-full px-3 text-[13px] font-semibold ${style}`}
    >
      {label}
    </span>
  );
}

/** How the job stands, in a sentence. Nothing to say about a plain delivery. */
function statusSentence(job: Job, yours: boolean) {
  const reviewed = job.reviewedAt ? ` on ${dateFmt.format(new Date(job.reviewedAt))}` : "";
  switch (job.status) {
    case "flagged": {
      const asCancelled =
        job.reportedAs === "cancelled" ? " The tracker reported it as cancelled." : "";
      if (!job.company) {
        return `The numbers on this job don't add up, so it doesn't count towards your totals.${asCancelled}`;
      }
      return yours
        ? `The numbers on this job don't add up, so it counts for nothing until a manager of ${job.company.name} approves it.${asCancelled}`
        : `The numbers on this job don't add up, so it counts for nothing until you or another manager decides.${asCancelled}`;
    }
    case "rejected":
      return `A manager rejected this job${reviewed}. It never counts.`;
    case "cancelled":
      return job.reviewedAt
        ? `It was flagged when it arrived and a manager approved it${reviewed} as the cancelled job it is. Cancelled jobs don't count towards distance, ranks or goals.`
        : "The job was cancelled in the game. Cancelled jobs don't count towards distance, ranks or goals.";
    case "delivered":
      return job.reviewedAt
        ? `It was flagged when it arrived and a manager approved it${reviewed}. It counts like any delivery.`
        : null;
  }
}

function StatusNote({
  job,
  yours,
  unit,
  children,
}: {
  job: Job;
  yours: boolean;
  unit: Unit;
  children?: ReactNode;
}) {
  const sentence = statusSentence(job, yours);
  if (!sentence && job.flagReasons.length === 0) return null;
  const open = job.status === "flagged";
  return (
    <section className="mt-6 space-y-4 rounded-2xl border bg-card p-5" aria-label="Status">
      {sentence && <p className="max-w-2xl text-[15px] leading-relaxed">{sentence}</p>}
      {job.flagReasons.length > 0 && (
        <div>
          <h2 className="text-[13px] font-semibold text-muted-foreground">
            {open ? "Why it is flagged" : "Why it was flagged"}
          </h2>
          <ul className="mt-2 space-y-1.5">
            {job.flagReasons.map((reason) => (
              <li key={reason} className="flex gap-2 text-[14px] leading-relaxed">
                <TriangleAlert
                  className={`mt-[3px] size-4 shrink-0 ${open ? "text-destructive" : "text-muted-foreground"}`}
                  aria-hidden="true"
                />
                <span>{describeFlag(reason, job, unit)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {children}
    </section>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[17px] font-semibold break-words">
        {value}
        {sub && <span className="block text-[13px] font-normal text-muted-foreground">{sub}</span>}
      </dd>
    </div>
  );
}

const EVENT_ICON: Record<JobEvent["type"], LucideIcon> = {
  fine: Siren,
  toll: Coins,
  ferry: Ship,
  train: TrainFront,
};

function Events({ events, game }: { events: Job["events"]; game: Job["game"] }) {
  return (
    <section className="mt-6 overflow-hidden rounded-2xl border bg-card">
      <div className="border-b px-5 py-3.5">
        <h2 className="text-[17px] font-bold tracking-tight">On the road</h2>
        <p className="mt-0.5 text-[13px] text-muted-foreground">
          Fines, tolls, ferries and trains, as the game charged them.
        </p>
      </div>
      {events.length === 0 ? (
        <p className="px-5 py-8 text-[15px] text-muted-foreground">
          The tracker reported no fines, tolls, ferries or trains on this job.
        </p>
      ) : (
        <>
          <ol className="divide-y">
            {events.map((event) => {
              const Icon = EVENT_ICON[event.type];
              return (
                <li key={event.id} className="flex items-center gap-3 px-5 py-3.5 text-[15px]">
                  <time
                    dateTime={new Date(event.at).toISOString()}
                    className="tabular w-11 shrink-0 text-[13px] text-muted-foreground"
                  >
                    {timeFmt.format(new Date(event.at))}
                  </time>
                  <Icon
                    className={`size-4 shrink-0 ${event.type === "fine" ? "text-destructive" : "text-muted-foreground"}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">{describeEvent(event)}</span>
                  <span className="tabular shrink-0 font-semibold">
                    {formatIncome(event.amount, game)}
                  </span>
                </li>
              );
            })}
          </ol>
          {events.length > 1 && (
            <div className="flex items-baseline justify-between gap-3 border-t bg-[var(--row-highlight)] px-5 py-3.5 text-[15px]">
              <span>
                <span className="font-semibold">Paid on the road</span>
                <span className="text-muted-foreground"> · {countEvents(events)}</span>
              </span>
              <span className="tabular shrink-0 font-semibold">
                {formatIncome(eventsTotal(events), game)}
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}
