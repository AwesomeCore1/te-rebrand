import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createFileRoute, stripSearchParams } from "@tanstack/react-router";
import { Skeleton } from "@te-rebrand/ui/components/skeleton";
import { z } from "zod";

import { Segmented } from "@/components/admin/admin-page";
import { formatDistance } from "@/lib/format";
import { useTRPC } from "@/utils/trpc";

// Every driver on Tacho on one board, whatever their VTC. Public. The period
// and game are in the address, so a board can be linked to.
const PERIODS = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "all", label: "All time" },
] as const;
const GAMES = [
  { value: "all", label: "Both games" },
  { value: "ets2", label: "ETS2" },
  { value: "ats", label: "ATS" },
] as const;

export const Route = createFileRoute("/leaderboards")({
  validateSearch: z.object({
    period: z.enum(["week", "month", "all"]).default("month").catch("month"),
    game: z.enum(["all", "ets2", "ats"]).default("all").catch("all"),
  }),
  // The defaults stay out of the address: /leaderboards is this month, both games.
  search: { middlewares: [stripSearchParams({ period: "month", game: "all" })] },
  component: LeaderboardsPage,
});

const EMPTY = {
  week: "No deliveries this week yet. The week starts on Monday, 00:00 UTC.",
  month: "No deliveries this month yet.",
  all: "No deliveries yet. The first driver to finish a job with the tracker running leads the board.",
};

function LeaderboardsPage() {
  const trpc = useTRPC();
  const navigate = Route.useNavigate();
  const { period, game } = Route.useSearch();
  const board = useQuery(
    trpc.leaderboards.drivers.queryOptions(
      { period, game: game === "all" ? undefined : game },
      // Keep the old rows on screen while another period or game loads.
      { placeholderData: keepPreviousData },
    ),
  );
  // Stored distances are km; a logged-in driver sees their own unit.
  const unit = board.data?.unit ?? "km";
  const gameName = game === "all" ? null : game === "ets2" ? "ETS2" : "ATS";

  return (
    <main className="mx-auto w-full max-w-3xl px-5 pt-28 pb-16 md:px-8">
      <h1 className="text-[clamp(2rem,4vw,2.75rem)] leading-none font-extrabold">Leaderboards</h1>
      <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
        Distance delivered by every driver on Tacho, across all VTCs and solo. Only finished
        deliveries count; weeks and months run on the UTC clock.
      </p>

      <div className="mt-7 flex flex-wrap gap-3">
        <Segmented
          label="Period"
          options={PERIODS}
          value={period}
          onChange={(p) => void navigate({ search: { period: p, game }, replace: true })}
        />
        <Segmented
          label="Game"
          options={GAMES}
          value={game}
          onChange={(g) => void navigate({ search: { period, game: g }, replace: true })}
        />
      </div>

      <div className="mt-5" aria-live="polite">
        {board.isError ? (
          <Notice>Couldn't load the leaderboard. Reload the page.</Notice>
        ) : !board.data ? (
          <BoardSkeleton />
        ) : board.data.rows.length === 0 ? (
          <Notice>
            {gameName && period !== "all"
              ? `No ${gameName} deliveries this ${period} yet.`
              : gameName
                ? `No ${gameName} deliveries yet.`
                : EMPTY[period]}
          </Notice>
        ) : (
          <div
            className={`overflow-hidden rounded-2xl border bg-card transition-opacity duration-150 ${board.isPlaceholderData ? "opacity-60" : ""}`}
          >
            <table className="tabular w-full text-left text-[14px]">
              <caption className="sr-only">
                Drivers by distance delivered, {PERIODS.find((p) => p.value === period)!.label}
                {gameName ? `, ${gameName}` : ""}
              </caption>
              <thead>
                <tr className="border-b text-[13px] text-muted-foreground">
                  <th scope="col" className="w-12 py-2.5 pl-5 font-medium">
                    <span className="sr-only">Place</span>
                  </th>
                  <th scope="col" className="w-full py-2.5 pr-3 font-medium">
                    Driver
                  </th>
                  <th
                    scope="col"
                    className="hidden py-2.5 pr-6 text-right font-medium sm:table-cell"
                  >
                    Jobs
                  </th>
                  <th scope="col" className="py-2.5 pr-5 text-right font-medium">
                    Distance
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {board.data.rows.map((r) => (
                  <tr key={r.driverId} className={r.you ? "bg-[var(--row-highlight)]" : undefined}>
                    <td className="py-3 pr-3 pl-5 text-muted-foreground">{r.place}</td>
                    <td className="max-w-0 py-3 pr-3">
                      <div className="truncate font-semibold">
                        {r.displayName}
                        {r.you && <span className="font-normal text-muted-foreground"> (you)</span>}
                      </div>
                      <div className="truncate text-[13px] text-muted-foreground">
                        {r.company ? (
                          // A plain link: the company page is public and outside this route's files.
                          <a
                            href={`/vtc/${r.company.slug}`}
                            className="rounded-sm underline-offset-2 hover:text-foreground hover:underline"
                          >
                            {r.company.tag ? `[${r.company.tag}] ` : ""}
                            {r.company.name}
                          </a>
                        ) : (
                          "Solo"
                        )}
                        <span className="sm:hidden"> · {jobs(r.jobs)}</span>
                      </div>
                    </td>
                    <td className="hidden py-3 pr-6 text-right text-muted-foreground sm:table-cell">
                      {r.jobs}
                    </td>
                    <td className="py-3 pr-5 text-right font-semibold whitespace-nowrap">
                      {formatDistance(r.km, unit)}
                    </td>
                  </tr>
                ))}
                {board.data.you && (
                  <tr className="bg-[var(--row-highlight)]">
                    <td className="py-3 pr-3 pl-5 text-muted-foreground">{board.data.you.place}</td>
                    <td className="py-3 pr-3 font-semibold">
                      You
                      <span className="font-normal text-muted-foreground sm:hidden">
                        {" "}
                        · {jobs(board.data.you.jobs)}
                      </span>
                    </td>
                    <td className="hidden py-3 pr-6 text-right text-muted-foreground sm:table-cell">
                      {board.data.you.jobs}
                    </td>
                    <td className="py-3 pr-5 text-right font-semibold whitespace-nowrap">
                      {formatDistance(board.data.you.km, unit)}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
        {board.data && board.data.drivers > board.data.rows.length && (
          <p className="tabular mt-3 text-[13px] text-muted-foreground">
            Top {board.data.rows.length} of {board.data.drivers} drivers.
          </p>
        )}
      </div>
    </main>
  );
}

const jobs = (n: number) => `${n} ${n === 1 ? "job" : "jobs"}`;

function Notice({ children }: { children: string }) {
  return (
    <p className="rounded-2xl border bg-card px-5 py-8 text-[15px] text-muted-foreground">
      {children}
    </p>
  );
}

function BoardSkeleton() {
  return (
    <div className="divide-y overflow-hidden rounded-2xl border bg-card" aria-busy="true">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-3.5">
          <Skeleton className="h-4 w-5" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-24" />
          </div>
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  );
}
