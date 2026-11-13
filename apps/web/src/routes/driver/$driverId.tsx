import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { buttonVariants } from "@te-rebrand/ui/components/button";
import { Skeleton } from "@te-rebrand/ui/components/skeleton";
import { cn } from "@te-rebrand/ui/lib/utils";
import type { ReactNode } from "react";

import { formatDate } from "@/components/company/bits";
import { GameBadge } from "@/components/landing/bits";
import { formatDistance } from "@/lib/format";
import { useTRPC } from "@/utils/trpc";

// A driver's public profile: what the leaderboards already show about them, in
// one place. Name, company and rank, and totals from delivered jobs. No job
// list and nothing about their accounts or trackers (the API sends none of it).
export const Route = createFileRoute("/driver/$driverId")({
  head: () => ({ meta: [{ title: "Driver profile · Tacho" }] }),
  component: DriverProfilePage,
});

type Unit = "km" | "mi";
const jobs = (n: number) => `${n} ${n === 1 ? "job" : "jobs"}`;

function DriverProfilePage() {
  const { driverId } = Route.useParams();
  const trpc = useTRPC();
  const profile = useQuery(trpc.profiles.driver.queryOptions({ driverId }, { retry: false }));

  if (profile.isError) {
    const missing = profile.error.data?.code === "NOT_FOUND";
    return (
      <Shell>
        <div className="rounded-2xl border bg-card px-5 py-10 md:px-8">
          <h1 className="text-3xl font-extrabold">
            {missing ? "No driver here" : "This page didn't load"}
          </h1>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-muted-foreground">
            {missing
              ? "There's no driver at this address. Check the link, or look for them on the leaderboards."
              : "Couldn't load the profile. Reload the page."}
          </p>
          {missing && (
            <Link to="/leaderboards" className={cn(buttonVariants({ variant: "outline" }), "mt-5")}>
              Open the leaderboards
            </Link>
          )}
        </div>
      </Shell>
    );
  }
  if (!profile.data) return <ProfileSkeleton />;

  const { displayName, joinedAt, company, totals, perGame, you } = profile.data;
  // Stored distances are km; a logged-in viewer sees their own unit.
  const unit: Unit = profile.data.unit ?? "km";
  const d = (km: number) => formatDistance(km, unit);

  return (
    <Shell>
      <header>
        <h1 className="text-[clamp(2rem,4vw,2.75rem)] leading-none font-extrabold break-words">
          {displayName}
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-2.5 gap-y-2 text-[15px] text-muted-foreground">
          {company ? (
            <>
              {company.tag && (
                <span className="inline-flex h-6 items-center rounded-full bg-secondary px-2.5 text-[12px] font-semibold text-foreground">
                  {company.tag}
                </span>
              )}
              <span>
                Drives for{" "}
                <Link
                  to="/vtc/$slug"
                  params={{ slug: company.slug }}
                  className="rounded-sm font-semibold text-signal-ink underline-offset-2 hover:underline"
                >
                  {company.name}
                </Link>
              </span>
            </>
          ) : (
            <span>Solo driver, not in a company</span>
          )}
        </div>
        <p className="tabular mt-1.5 text-[14px] text-muted-foreground">
          On Tacho since {formatDate(joinedAt)}
        </p>
        {you && (
          <p className="mt-3 text-[13px] leading-relaxed text-muted-foreground">
            This is your public profile. Everyone sees this page as you do, in their own unit.
          </p>
        )}
      </header>

      <section
        className="tabular grid grid-cols-2 gap-3 md:grid-cols-3"
        aria-label="Driver numbers"
      >
        <Stat label="This month" value={d(totals.monthKm)} sub={jobs(totals.monthJobs)} />
        <Stat label="All time" value={d(totals.allTimeKm)} sub={jobs(totals.allTimeJobs)} />
        <Stat
          className="col-span-2 md:col-span-1"
          label="Rank"
          value={company ? (company.rank?.name ?? "Unranked") : "None"}
          sub={
            company ? (
              <>
                in{" "}
                <Link
                  to="/vtc/$slug"
                  params={{ slug: company.slug }}
                  className="rounded-sm underline-offset-2 hover:text-foreground hover:underline"
                >
                  {company.name}
                </Link>
              </>
            ) : (
              "Ranks come with a company"
            )
          }
        />
      </section>

      <section className="overflow-hidden rounded-2xl border bg-card" aria-labelledby="by-game">
        <h2 id="by-game" className="border-b px-5 py-3.5 text-[17px] font-bold tracking-tight">
          By game
        </h2>
        {totals.allTimeJobs === 0 ? (
          <p className="px-5 py-8 text-[15px] leading-relaxed text-muted-foreground">
            No deliveries yet. {displayName}'s distance shows here after their first finished job.
          </p>
        ) : (
          <table className="tabular w-full text-left text-[14px]">
            <thead>
              <tr className="border-b text-[13px] text-muted-foreground">
                <th scope="col" className="w-full py-2.5 pl-5 font-medium">
                  Game
                </th>
                <th scope="col" className="py-2.5 pr-6 text-right font-medium whitespace-nowrap">
                  This month
                </th>
                <th scope="col" className="py-2.5 pr-5 text-right font-medium whitespace-nowrap">
                  All time
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {perGame.map((g) => (
                <tr key={g.game}>
                  <th scope="row" className="py-3 pl-5 font-normal">
                    <GameBadge game={g.game === "ets2" ? "ETS2" : "ATS"} />
                    <span className="sr-only">
                      {g.game === "ets2" ? "Euro Truck Simulator 2" : "American Truck Simulator"}
                    </span>
                  </th>
                  <Amount km={d(g.monthKm)} count={jobs(g.monthJobs)} className="pr-6" />
                  <Amount km={d(g.allTimeKm)} count={jobs(g.allTimeJobs)} className="pr-5" />
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="text-[13px] leading-relaxed text-muted-foreground">
        Delivered jobs only. Months run on the UTC clock, like the{" "}
        <Link
          to="/leaderboards"
          className="rounded-sm font-medium text-signal-ink underline-offset-2 hover:underline"
        >
          leaderboards
        </Link>
        .
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-5 pt-28 pb-16 md:px-8">{children}</main>
  );
}

function Stat({
  label,
  value,
  sub,
  className = "",
}: {
  label: string;
  value: string;
  sub: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 rounded-2xl border bg-card p-4 ${className}`}>
      <div className="text-[13px] text-muted-foreground">{label}</div>
      {/* Two lines at most: a long rank name wraps before it is cut. */}
      <div
        className="mt-1 line-clamp-2 text-xl leading-tight font-semibold break-words md:text-2xl"
        title={value}
      >
        {value}
      </div>
      <div className="mt-0.5 truncate text-[13px] text-muted-foreground">{sub}</div>
    </div>
  );
}

function Amount({ km, count, className }: { km: string; count: string; className: string }) {
  return (
    <td className={`py-3 text-right whitespace-nowrap ${className}`}>
      <div className="font-semibold">{km}</div>
      <div className="text-[13px] text-muted-foreground">{count}</div>
    </td>
  );
}

function ProfileSkeleton() {
  return (
    <Shell>
      <div className="space-y-3" aria-busy="true">
        <Skeleton className="h-10 w-64 max-w-full" />
        <Skeleton className="h-5 w-48" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton
            key={i}
            className={`h-24 rounded-2xl ${i === 2 ? "col-span-2 md:col-span-1" : ""}`}
          />
        ))}
      </div>
      <Skeleton className="h-44 rounded-2xl" />
    </Shell>
  );
}
