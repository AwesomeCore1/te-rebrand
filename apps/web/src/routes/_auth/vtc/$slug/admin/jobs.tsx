import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@te-rebrand/ui/components/button";
import { ArrowRight, Check, TriangleAlert, X } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  type AdminCompany,
  AdminHeader,
  AdminPage,
  loadError,
  Notice,
  RowsSkeleton,
  saveError,
} from "@/components/admin/admin-page";
import { GameBadge } from "@/components/landing/bits";
import { describeFlag, formatDuration, jobDurationMs } from "@/lib/flag-reasons";
import { formatDistance, formatIncome, formatWhen } from "@/lib/format";
import { useTRPC } from "@/utils/trpc";

// The review queue: jobs whose numbers did not add up when they arrived. They
// count for nothing until a manager approves them.
export const Route = createFileRoute("/_auth/vtc/$slug/admin/jobs")({
  component: JobsTab,
});

function JobsTab() {
  const { slug } = Route.useParams();
  return <AdminPage slug={slug}>{(company) => <FlaggedJobs company={company} />}</AdminPage>;
}

function FlaggedJobs({ company }: { company: AdminCompany }) {
  const trpc = useTRPC();
  const queue = useQuery(trpc.admin.jobs.flagged.queryOptions({ companyId: company.id }));
  // The manager's own unit, like everywhere else they read distances.
  const me = useQuery(trpc.driver.me.queryOptions());
  const unit = me.data?.driver.unitPreference ?? "km";

  return (
    <>
      <AdminHeader title="Flagged jobs">
        Jobs the tracker sent with numbers that don't add up. They count for nothing until you
        decide: approve one and it counts like any delivery for {company.name}, reject it and it
        never does.
      </AdminHeader>

      {queue.isError ? (
        <Notice>{loadError(queue.error, "the flagged jobs", company)}</Notice>
      ) : !queue.data ? (
        <RowsSkeleton rows={3} />
      ) : queue.data.length === 0 ? (
        <Notice>
          Nothing to review. A job lands here when its distance, speed or times look impossible.
        </Notice>
      ) : (
        <>
          <p className="tabular text-[14px] text-muted-foreground">
            {queue.data.length} {queue.data.length === 1 ? "job is" : "jobs are"} waiting, newest
            first.
          </p>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {queue.data.map((job) => (
              <li key={job.id}>
                <FlaggedJob company={company} job={job} unit={unit} />
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}

type Job = {
  id: string;
  game: "ets2" | "ats";
  multiplayer: boolean;
  sourceCity: string;
  sourceCompany: string;
  destCity: string;
  destCompany: string;
  cargo: string;
  cargoMassKg: number;
  plannedKm: number;
  drivenKm: number;
  odometerStart: number;
  odometerEnd: number;
  income: number;
  damagePct: number;
  maxSpeedKmh: number;
  startedAt: string;
  finishedAt: string;
  flagReasons: string[];
  reportedAs: string | null;
  driver: { id: string; displayName: string };
};

function FlaggedJob({
  company,
  job,
  unit,
}: {
  company: AdminCompany;
  job: Job;
  unit: "km" | "mi";
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [confirmReject, setConfirmReject] = useState(false);

  const decided = async (message: string) => {
    toast.success(message);
    await queryClient.invalidateQueries({ queryKey: trpc.admin.jobs.pathKey() });
  };
  const onError = (e: Parameters<typeof saveError>[0]) => {
    toast.error(saveError(e));
    // Someone else may have decided it in the meantime.
    void queryClient.invalidateQueries({ queryKey: trpc.admin.jobs.pathKey() });
  };
  const cancelled = job.reportedAs === "cancelled";
  const approve = useMutation(
    trpc.admin.jobs.approve.mutationOptions({
      onSuccess: () =>
        decided(
          cancelled
            ? `Approved. It is back as a cancelled job for ${job.driver.displayName}.`
            : `Approved. It now counts for ${job.driver.displayName}.`,
        ),
      onError,
    }),
  );
  const reject = useMutation(
    trpc.admin.jobs.reject.mutationOptions({
      onSuccess: () => decided("Rejected. It will never count."),
      onError,
    }),
  );
  const busy = approve.isPending || reject.isPending;
  const d = (km: number) => formatDistance(km, unit);
  const speed =
    unit === "mi"
      ? `${Math.round(job.maxSpeedKmh / 1.609344)} mph`
      : `${Math.round(job.maxSpeedKmh)} km/h`;

  return (
    <article
      className="space-y-4 px-4 py-5 sm:px-5"
      aria-label={`${job.sourceCity} to ${job.destCity}, ${job.driver.displayName}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <h3 className="text-[16px] font-bold">
            {job.sourceCity}{" "}
            <ArrowRight className="inline size-4 align-[-2px] text-signal-ink" aria-label="to" />{" "}
            {job.destCity}
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
            <GameBadge game={job.game === "ets2" ? "ETS2" : "ATS"} />
            <span className="font-semibold text-foreground">{job.driver.displayName}</span>
            <span>
              · {job.cargo}, {(job.cargoMassKg / 1000).toFixed(1)} t
            </span>
            {job.multiplayer && <span>· TruckersMP</span>}
            <span>· {formatWhen(job.finishedAt)}</span>
            {cancelled && <span>· reported as cancelled</span>}
          </div>
        </div>
      </div>

      <ul className="space-y-1.5">
        {job.flagReasons.map((reason) => (
          <li key={reason} className="flex gap-2 text-[14px] leading-relaxed">
            <TriangleAlert
              className="mt-[3px] size-4 shrink-0 text-destructive"
              aria-hidden="true"
            />
            <span>{describeFlag(reason, job, unit)}</span>
          </li>
        ))}
        {job.flagReasons.length === 0 && (
          <li className="text-[14px] text-muted-foreground">Flagged without a stated reason.</li>
        )}
      </ul>

      <dl className="tabular grid grid-cols-2 gap-x-6 gap-y-3 text-[14px] sm:grid-cols-3 lg:grid-cols-6">
        <Figure label="Driven" value={d(job.drivenKm)} />
        <Figure label="Planned" value={d(job.plannedKm)} />
        <Figure label="Odometer" value={d(job.odometerEnd - job.odometerStart)} />
        <Figure label="Time" value={formatDuration(jobDurationMs(job))} />
        <Figure label="Top speed" value={speed} />
        <Figure
          label="Income"
          value={formatIncome(job.income, job.game)}
          sub={job.damagePct > 0 ? `${job.damagePct.toFixed(1)} % damage` : undefined}
        />
      </dl>

      {confirmReject ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl bg-[var(--row-highlight)] px-4 py-3">
          <p className="min-w-0 flex-1 basis-56 text-[14px] leading-relaxed">
            <span className="font-semibold">Reject this job?</span>{" "}
            <span className="text-muted-foreground">
              It leaves the queue and can't be brought back.
            </span>
          </p>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => reject.mutate({ companyId: company.id, jobId: job.id })}
            >
              {reject.isPending ? "Rejecting…" : "Reject job"}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setConfirmReject(false)}
              autoFocus
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => approve.mutate({ companyId: company.id, jobId: job.id })}
          >
            <Check className="text-success" /> {approve.isPending ? "Approving…" : "Approve"}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setConfirmReject(true)}>
            <X /> Reject
          </Button>
        </div>
      )}
    </article>
  );
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 font-semibold">
        {value}
        {sub && <span className="block text-[13px] font-normal text-muted-foreground">{sub}</span>}
      </dd>
    </div>
  );
}
