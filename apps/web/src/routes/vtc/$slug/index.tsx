import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@te-rebrand/ui/components/button";
import { Label } from "@te-rebrand/ui/components/label";
import { Skeleton } from "@te-rebrand/ui/components/skeleton";
import { Textarea } from "@te-rebrand/ui/components/textarea";
import { ExternalLink, LogOut, Settings2 } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
import { toast } from "sonner";

import { Segmented } from "@/components/admin/admin-page";
import {
  actionError,
  CompanyLogo,
  ConfirmAction,
  formatDate,
  roleLabel,
  VerifiedMark,
} from "@/components/company/bits";
import { ConvoyRow } from "@/components/convoy-row";
import { Markdown } from "@/components/markdown";
import { formatDistance, formatWhen } from "@/lib/format";
import { steamConnectHref, useSteamResult } from "@/lib/use-steam-result";
import { useTRPC } from "@/utils/trpc";

// A company's public page: who they are, their numbers, the leaderboard, their
// convoys, and the recruitment form. Anyone can read it; applying needs a login.
export const Route = createFileRoute("/vtc/$slug/")({
  component: CompanyPage,
});

type Unit = "km" | "mi";
type Period = "week" | "month" | "all";
const MAX_ANSWER = 1000;

function CompanyPage() {
  const { slug } = Route.useParams();
  const trpc = useTRPC();
  useSteamResult();
  const page = useQuery(trpc.company.page.queryOptions({ slug }, { retry: false }));
  const viewer = useQuery(trpc.company.viewer.queryOptions({ slug }, { retry: false }));

  if (page.isError) {
    const missing = page.error.data?.code === "NOT_FOUND";
    return (
      <Shell>
        <div className="rounded-2xl border bg-card px-5 py-10 md:px-8">
          <h1 className="text-3xl font-extrabold">
            {missing ? "No company here" : "This page didn't load"}
          </h1>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
            {missing
              ? "There's no company at this address. Check the link, or ask the VTC for theirs."
              : "Couldn't load the company. Reload the page."}
          </p>
        </div>
      </Shell>
    );
  }
  if (!page.data) return <PageSkeleton />;

  const company = page.data;
  const me = viewer.data?.signedIn ? viewer.data : null;
  const unit: Unit = me?.unit ?? "km";
  const here = me?.membership?.here ? me.membership : null;
  const manages = here !== null && here.role !== "driver";
  const { stats, recruitment } = company;

  return (
    <Shell>
      <header className="flex flex-wrap items-center gap-x-5 gap-y-4">
        <CompanyLogo name={company.name} tag={company.tag} logoUrl={company.logoUrl} />
        <div className="min-w-0 flex-1 basis-64">
          <h1 className="text-[clamp(2rem,4vw,2.75rem)] leading-none font-extrabold break-words">
            {company.name}
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-[14px] text-muted-foreground">
            {company.tag && (
              <span className="inline-flex h-6 items-center rounded-full bg-secondary px-2.5 text-[12px] font-semibold text-foreground">
                {company.tag}
              </span>
            )}
            {company.verifiedAt && <VerifiedMark />}
            {company.truckersmpVtcId !== null && (
              <a
                href={`https://truckersmp.com/vtc/${company.truckersmpVtcId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-md font-medium text-signal-ink underline-offset-2 hover:underline"
              >
                On TruckersMP <ExternalLink className="size-3.5" aria-hidden="true" />
              </a>
            )}
          </div>
        </div>
        {manages && (
          <Link to="/vtc/$slug/admin" params={{ slug }}>
            <Button variant="outline">
              <Settings2 /> Company admin
            </Button>
          </Link>
        )}
      </header>

      <section
        className="tabular grid grid-cols-2 gap-3 md:grid-cols-4"
        aria-label="Company numbers"
      >
        <Stat
          label="Members"
          value={String(stats.members)}
          sub={stats.members === 1 ? "active driver" : "active drivers"}
        />
        <Stat
          label="This month"
          value={formatDistance(stats.monthKm, unit)}
          sub={jobs(stats.monthJobs)}
        />
        <Stat
          label="All time"
          value={formatDistance(stats.allTimeKm, unit)}
          sub={jobs(stats.allTimeJobs)}
        />
        <Stat
          label="Recruitment"
          value={recruitment.open ? "Open" : "Closed"}
          sub={recruitment.open ? "Apply on this page" : "Not recruiting now"}
        />
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <Card title="About">
            <div className="p-5">
              {company.about.trim() ? (
                <Markdown>{company.about}</Markdown>
              ) : (
                <p className="text-[15px] text-muted-foreground">
                  {manages ? (
                    <>
                      Nothing here yet. Write a few lines about {company.name} under{" "}
                      <Link
                        to="/vtc/$slug/admin/settings"
                        params={{ slug }}
                        className="font-medium text-signal-ink underline-offset-2 hover:underline"
                      >
                        Settings
                      </Link>
                      .
                    </>
                  ) : (
                    `${company.name} hasn't written anything about itself yet.`
                  )}
                </p>
              )}
            </div>
          </Card>
          <Leaderboard
            companyId={company.id}
            companyName={company.name}
            unit={unit}
            viewerDriverId={me?.driverId ?? null}
          />
        </div>

        <div className="min-w-0 space-y-6">
          <JoinCard slug={slug} company={company} viewer={viewer.isError ? "error" : viewer.data} />
          <Convoys slug={slug} companyName={company.name} />
        </div>
      </div>
    </Shell>
  );
}

const jobs = (n: number) => `${n} ${n === 1 ? "job" : "jobs"} delivered`;

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-5 pt-28 pb-16 md:px-8">{children}</main>
  );
}

function PageSkeleton() {
  return (
    <Shell>
      <div className="flex items-center gap-5" aria-busy="true">
        <Skeleton className="size-16 rounded-2xl" />
        <div className="space-y-3">
          <Skeleton className="h-9 w-64 max-w-full" />
          <Skeleton className="h-5 w-40" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-2xl" />
        ))}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Skeleton className="h-96 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    </Shell>
  );
}

function Card({
  title,
  action,
  children,
  id,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="scroll-mt-24 overflow-hidden rounded-2xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-5 py-3.5">
        <h2 className="text-[17px] font-bold tracking-tight">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const Quiet = ({ children }: { children: ReactNode }) => (
  <p className="px-5 py-8 text-[15px] leading-relaxed text-muted-foreground">{children}</p>
);

function Stat({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="min-w-0 rounded-2xl border bg-card p-4">
      <div className="text-[13px] text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-xl font-semibold md:text-2xl">{value}</div>
      <div className="mt-0.5 truncate text-[13px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function RowsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="divide-y" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-5 py-3">
          <Skeleton className="h-5 w-5" />
          <Skeleton className="h-5 w-36" />
          <Skeleton className="ml-auto h-5 w-20" />
        </div>
      ))}
    </div>
  );
}

const PERIODS = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "all", label: "All time" },
] as const;
const NO_DELIVERIES: Record<Period, string> = {
  week: "No deliveries this week yet.",
  month: "No deliveries this month yet.",
  all: "No deliveries yet.",
};

function Leaderboard({
  companyId,
  companyName,
  unit,
  viewerDriverId,
}: {
  companyId: string;
  companyName: string;
  unit: Unit;
  viewerDriverId: string | null;
}) {
  const trpc = useTRPC();
  const [period, setPeriod] = useState<Period>("month");
  const board = useQuery(trpc.leaderboard.get.queryOptions({ companyId, period, limit: 10 }));

  return (
    <Card
      title="Leaderboard"
      action={
        <Segmented
          label="Leaderboard period"
          options={PERIODS}
          value={period}
          onChange={setPeriod}
        />
      }
    >
      {board.isError ? (
        <Quiet>Couldn't load the leaderboard. Reload the page.</Quiet>
      ) : !board.data ? (
        <RowsSkeleton rows={5} />
      ) : board.data.length === 0 ? (
        <Quiet>{NO_DELIVERIES[period]}</Quiet>
      ) : (
        <ol className="tabular divide-y text-[14px]" aria-label={`${companyName} leaderboard`}>
          {board.data.map((r) => {
            const you = r.driverId === viewerDriverId;
            return (
              <li
                key={r.driverId}
                className={`flex items-center gap-3 px-5 py-2.5 ${you ? "bg-[var(--row-highlight)]" : ""}`}
              >
                <span className="w-5 shrink-0 text-muted-foreground">{r.rank}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">
                  <Link
                    to="/driver/$driverId"
                    params={{ driverId: r.driverId }}
                    className="rounded-sm underline-offset-2 hover:underline"
                  >
                    {r.displayName}
                  </Link>
                  {you && <span className="font-normal text-muted-foreground"> (you)</span>}
                </span>
                <span className="hidden shrink-0 text-muted-foreground sm:inline">
                  {r.jobs} {r.jobs === 1 ? "job" : "jobs"}
                </span>
                <span className="w-24 shrink-0 text-right font-semibold">
                  {formatDistance(r.km, unit)}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function Convoys({ slug, companyName }: { slug: string; companyName: string }) {
  const trpc = useTRPC();
  const convoys = useQuery(trpc.company.convoys.queryOptions({ slug }));
  return (
    <Card title="Upcoming convoys">
      {convoys.isError || convoys.data?.unavailable ? (
        <Quiet>Couldn't reach TruckersMP right now. Convoys will be back shortly.</Quiet>
      ) : !convoys.data ? (
        <RowsSkeleton rows={3} />
      ) : !convoys.data.hasVtc ? (
        <Quiet>
          Convoys come from TruckersMP. {companyName} has no TruckersMP VTC linked, so there are
          none to show.
        </Quiet>
      ) : convoys.data.events.length === 0 ? (
        <Quiet>{companyName} has no upcoming convoys on TruckersMP.</Quiet>
      ) : (
        <ul className="divide-y">
          {convoys.data.events.map((e) => (
            <li key={e.id}>
              <ConvoyRow convoy={e} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

type Company = {
  id: string;
  name: string;
  truckersmpVtcId: number | null;
  recruitment: { open: boolean; questions: string[] };
};
type Viewer =
  | { signedIn: false }
  | {
      signedIn: true;
      steamLinked: boolean;
      membership: {
        role: "owner" | "manager" | "driver";
        joinedAt: Date | string;
        here: boolean;
        company: { name: string; slug: string };
      } | null;
      application: { id: string; createdAt: Date | string } | null;
    };

/**
 * The card that answers "can I join?", for every kind of visitor: a member, a
 * member of another company, an applicant, someone without Steam linked,
 * someone logged out, and someone who can fill in the form.
 */
function JoinCard({
  slug,
  company,
  viewer,
}: {
  slug: string;
  company: Company;
  viewer: Viewer | "error" | undefined;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: trpc.company.viewer.queryKey({ slug }) }),
      queryClient.invalidateQueries({ queryKey: trpc.company.page.queryKey({ slug }) }),
      queryClient.invalidateQueries({ queryKey: trpc.driver.dashboard.queryKey() }),
    ]);
  const leave = useMutation(
    trpc.memberships.leave.mutationOptions({
      onSuccess: () => {
        toast.success(`You left ${company.name}.`);
        return refresh();
      },
      onError: (e) => toast.error(actionError(e)),
    }),
  );
  const withdraw = useMutation(
    trpc.applications.withdraw.mutationOptions({
      onSuccess: () => {
        toast.success("Application withdrawn.");
        return refresh();
      },
      onError: (e) => {
        toast.error(actionError(e));
        return refresh();
      },
    }),
  );

  const { open } = company.recruitment;
  const membership = viewer !== "error" && viewer?.signedIn ? viewer.membership : null;

  if (membership?.here) {
    return (
      <Card id="join" title="Your membership">
        <div className="space-y-4 p-5">
          <p className="text-[15px] leading-relaxed">
            You're {membership.role === "owner" ? "the" : "a"}{" "}
            <span className="font-semibold">{roleLabel(membership.role).toLowerCase()}</span> of{" "}
            {company.name}
            <span className="text-muted-foreground">
              , since {formatDate(membership.joinedAt)}. Your deliveries count for this company.
            </span>
          </p>
          {membership.role === "owner" ? (
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              The owner can't leave: ownership can't be handed over yet.
            </p>
          ) : (
            <ConfirmAction
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

  const title = `Join ${company.name}`;
  if (!open) {
    return (
      <Card id="join" title={title}>
        <Quiet>{company.name} isn't taking applications right now.</Quiet>
      </Card>
    );
  }
  if (viewer === "error") {
    return (
      <Card id="join" title={title}>
        <Quiet>Couldn't check whether you can apply. Reload the page.</Quiet>
      </Card>
    );
  }
  if (!viewer) {
    return (
      <Card id="join" title={title}>
        <div className="space-y-3 p-5" aria-busy="true">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-10 w-36" />
        </div>
      </Card>
    );
  }
  if (!viewer.signedIn) {
    return (
      <Card id="join" title={title}>
        <div className="space-y-4 p-5">
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            {company.name} is recruiting.{" "}
            {company.recruitment.questions.length > 0
              ? `The form has ${company.recruitment.questions.length} ${company.recruitment.questions.length === 1 ? "question" : "questions"}.`
              : "There are no questions to answer."}{" "}
            Log in to send your application.
          </p>
          <Link to="/login" search={{ redirect: `/vtc/${slug}` }}>
            <Button>Log in to apply</Button>
          </Link>
        </div>
      </Card>
    );
  }
  if (membership) {
    return (
      <Card id="join" title={title}>
        <div className="space-y-3 p-5 text-[15px] leading-relaxed">
          <p>
            You're in{" "}
            <Link
              to="/vtc/$slug"
              params={{ slug: membership.company.slug }}
              className="font-semibold text-signal-ink underline-offset-2 hover:underline"
            >
              {membership.company.name}
            </Link>
            .
          </p>
          <p className="text-muted-foreground">
            A driver has one company at a time, like on TruckersMP. Leave {membership.company.name}{" "}
            first if you want to apply here.
          </p>
        </div>
      </Card>
    );
  }
  if (viewer.application) {
    return (
      <Card id="join" title="Your application">
        <div className="space-y-4 p-5">
          <p className="text-[15px] leading-relaxed">
            Sent {formatWhen(viewer.application.createdAt)}.{" "}
            <span className="text-muted-foreground">
              A manager of {company.name} will accept or reject it.
              {company.truckersmpVtcId !== null &&
                ` They can only accept you once you're in ${company.name} on TruckersMP.`}
            </span>
          </p>
          <ConfirmAction
            label="Withdraw application"
            question="Withdraw your application?"
            detail="You can apply again later."
            confirmLabel="Withdraw"
            pendingLabel="Withdrawing…"
            pending={withdraw.isPending}
            onConfirm={() => withdraw.mutate({ applicationId: viewer.application!.id })}
          />
        </div>
      </Card>
    );
  }
  if (!viewer.steamLinked) {
    return (
      <Card id="join" title={title}>
        <div className="space-y-4 p-5">
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            Link Steam before you apply. It's how {company.name} checks on TruckersMP that you're in
            their VTC. You come back to this page afterwards.
          </p>
          {/* A plain link: a full-page redirect to Steam, not an API call. */}
          <a href={steamConnectHref(`/vtc/${slug}#join`)}>
            <Button>Connect Steam</Button>
          </a>
        </div>
      </Card>
    );
  }
  return (
    <Card id="join" title={title}>
      <ApplicationForm company={company} onSent={refresh} />
    </Card>
  );
}

function ApplicationForm({
  company,
  onSent,
}: {
  company: Company;
  onSent: () => Promise<unknown>;
}) {
  const trpc = useTRPC();
  const { questions } = company.recruitment;
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ""));
  const [showMissing, setShowMissing] = useState(false);
  const submit = useMutation(
    trpc.applications.submit.mutationOptions({
      onSuccess: () => {
        toast.success("Application sent.");
        return onSent();
      },
    }),
  );
  const missing = (i: number) => (answers[i] ?? "").trim().length === 0;

  function send(e: FormEvent) {
    e.preventDefault();
    if (questions.some((_, i) => missing(i))) {
      setShowMissing(true);
      return;
    }
    submit.mutate({ companyId: company.id, answers: questions.map((_, i) => answers[i] ?? "") });
  }

  return (
    <form className="space-y-5 p-5" onSubmit={send} noValidate>
      {questions.length === 0 ? (
        <p className="text-[15px] leading-relaxed text-muted-foreground">
          {company.name} asks no questions. Send your application and a manager will accept or
          reject it.
        </p>
      ) : (
        questions.map((question, i) => {
          const invalid = showMissing && missing(i);
          return (
            <div key={`${i}-${question}`} className="space-y-2">
              <Label htmlFor={`answer-${i}`} className="text-[14px] leading-snug font-semibold">
                {question}
              </Label>
              <Textarea
                id={`answer-${i}`}
                value={answers[i] ?? ""}
                maxLength={MAX_ANSWER}
                rows={3}
                disabled={submit.isPending}
                aria-invalid={invalid || undefined}
                aria-describedby={invalid ? `answer-${i}-error` : undefined}
                onChange={(e) =>
                  setAnswers((current) =>
                    questions.map((_, j) => (j === i ? e.target.value : (current[j] ?? ""))),
                  )
                }
                className="min-h-20 bg-card px-3 py-2.5 text-[15px] leading-relaxed md:text-sm dark:bg-input/30"
              />
              {invalid && (
                <p id={`answer-${i}-error`} role="alert" className="text-[13px] text-destructive">
                  Answer this question.
                </p>
              )}
            </div>
          );
        })
      )}
      {company.truckersmpVtcId !== null && (
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          To be accepted you need to be in {company.name} on TruckersMP. Tacho checks that when a
          manager accepts you.
        </p>
      )}
      {submit.isError && (
        <p role="alert" className="text-[14px] text-destructive">
          {actionError(submit.error, "Couldn't send your application. Try again.")}
        </p>
      )}
      <Button type="submit" className="w-full sm:w-auto" disabled={submit.isPending}>
        {submit.isPending ? "Sending…" : "Send application"}
      </Button>
    </form>
  );
}
