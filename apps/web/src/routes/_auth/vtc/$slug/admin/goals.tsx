import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@te-rebrand/ui/components/button";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { type FormEvent, useState } from "react";
import { toast } from "sonner";

import {
  type AdminCompany,
  AdminHeader,
  AdminPage,
  Field,
  loadError,
  Notice,
  RowsSkeleton,
  saveError,
  Segmented,
} from "@/components/admin/admin-page";
import { formatDistance } from "@/lib/format";
import { useTRPC } from "@/utils/trpc";

// Company goals. Progress is counted by the API from delivered jobs between
// the two dates; nothing here adds numbers up. Targets are km, as stored.
export const Route = createFileRoute("/_auth/vtc/$slug/admin/goals")({
  component: GoalsTab,
});

function GoalsTab() {
  const { slug } = Route.useParams();
  return <AdminPage slug={slug}>{(company) => <Goals company={company} />}</AdminPage>;
}

type Metric = "km" | "jobs" | "income";
type Goal = {
  id: string;
  title: string;
  metric: Metric;
  target: number;
  startAt: string;
  endAt: string;
  phase: "current" | "upcoming" | "past";
  done: number;
};
type Open = { kind: "new" } | { kind: "edit" | "delete"; id: string } | null;

const METRICS = [
  { value: "km", label: "Distance" },
  { value: "jobs", label: "Jobs" },
  { value: "income", label: "Income" },
] as const;
const GROUPS = [
  { phase: "current", title: "Running" },
  { phase: "upcoming", title: "Upcoming" },
  { phase: "past", title: "Past" },
] as const;

const grouped = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });
/** Income is in the games' own currencies (EUR in ETS2, USD in ATS), added up as it is. */
function amount(n: number, metric: Metric) {
  if (metric === "km") return formatDistance(n, "km");
  const number = grouped.format(n).replace(/,/g, " ");
  return metric === "jobs" ? `${number} ${n === 1 ? "job" : "jobs"}` : `${number} in income`;
}

// Goals run on whole days in UTC, the clock the leaderboards use.
const day = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});
const dates = (g: { startAt: string; endAt: string }) =>
  `${day.format(new Date(g.startAt))} to ${day.format(new Date(g.endAt))}`;

function Goals({ company }: { company: AdminCompany }) {
  const trpc = useTRPC();
  const [open, setOpen] = useState<Open>(null);
  const list = useQuery(trpc.admin.goals.list.queryOptions({ companyId: company.id }));
  const goals = list.data ?? [];

  return (
    <>
      <AdminHeader
        title="Goals"
        action={
          list.data && open === null ? (
            <Button onClick={() => setOpen({ kind: "new" })}>
              <Plus /> Add goal
            </Button>
          ) : null
        }
      >
        Something for {company.name} to reach together: distance, jobs or income between two dates.
        Progress counts every delivered job in that time, and the running goal shows on each
        driver's dashboard.
      </AdminHeader>

      {open?.kind === "new" && (
        <div className="overflow-hidden rounded-2xl border bg-card">
          <GoalForm company={company} onDone={() => setOpen(null)} />
        </div>
      )}

      {list.isError ? (
        <Notice>{loadError(list.error, "the goals", company)}</Notice>
      ) : !list.data ? (
        <RowsSkeleton rows={3} />
      ) : goals.length === 0 ? (
        open === null && (
          <Notice>
            No goals yet. Add one, for example 100 000 km together this month, and drivers see it on
            their dashboard from its first day.
          </Notice>
        )
      ) : (
        GROUPS.map(({ phase, title }) => {
          const inPhase = goals.filter((g) => g.phase === phase);
          if (inPhase.length === 0) return null;
          return (
            <section key={phase} aria-labelledby={`goals-${phase}`}>
              <h3
                id={`goals-${phase}`}
                className="mb-2 text-[15px] font-bold text-muted-foreground"
              >
                {title}
              </h3>
              <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
                {inPhase.map((goal) => (
                  <li key={goal.id}>
                    {open?.kind === "edit" && open.id === goal.id ? (
                      <GoalForm company={company} goal={goal} onDone={() => setOpen(null)} />
                    ) : open?.kind === "delete" && open.id === goal.id ? (
                      <DeleteGoal company={company} goal={goal} onDone={() => setOpen(null)} />
                    ) : (
                      <GoalRow
                        goal={goal}
                        onEdit={() => setOpen({ kind: "edit", id: goal.id })}
                        onDelete={() => setOpen({ kind: "delete", id: goal.id })}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </>
  );
}

function GoalRow({
  goal,
  onEdit,
  onDelete,
}: {
  goal: Goal;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const pct = Math.min(100, (goal.done / goal.target) * 100);
  const reached = goal.done >= goal.target;
  return (
    <div className="flex items-start gap-3 px-4 py-4 sm:gap-4 sm:px-5">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="font-display text-[17px] font-bold">{goal.title}</span>
          <span className="tabular text-[13px] text-muted-foreground">{dates(goal)}</span>
        </div>
        {goal.phase === "upcoming" ? (
          <p className="tabular mt-1.5 text-[14px] text-muted-foreground">
            Target {amount(goal.target, goal.metric)}. Counting starts on the first day.
          </p>
        ) : (
          <>
            <div
              className="mt-3 h-2 overflow-hidden rounded-full bg-secondary"
              role="progressbar"
              aria-label={`${goal.title} progress`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(pct)}
            >
              <div
                className={`h-full rounded-full ${goal.phase === "past" && !reached ? "bg-muted-foreground/50" : "bg-primary"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <p className="tabular mt-2 text-[14px]">
              <span className="font-semibold">
                {amount(goal.done, goal.metric)} of {amount(goal.target, goal.metric)}
              </span>
              <span className="text-muted-foreground">
                {" · "}
                {Math.floor((goal.done / goal.target) * 100)} %
                {reached ? " · reached" : goal.phase === "past" ? " · not reached" : ""}
              </span>
            </p>
          </>
        )}
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${goal.title}`} onClick={onEdit}>
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${goal.title}`}
          onClick={onDelete}
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

function useGoalsChanged(company: AdminCompany) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      queryKey: trpc.admin.goals.list.queryKey({ companyId: company.id }),
    });
}

function GoalForm({
  company,
  goal,
  onDone,
}: {
  company: AdminCompany;
  goal?: Goal;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const changed = useGoalsChanged(company);
  const [title, setTitle] = useState(goal?.title ?? "");
  const [metric, setMetric] = useState<Metric>(goal?.metric ?? "km");
  const [target, setTarget] = useState(goal ? String(goal.target) : "");
  const [from, setFrom] = useState(goal?.startAt.slice(0, 10) ?? "");
  const [to, setTo] = useState(goal?.endAt.slice(0, 10) ?? "");
  const [checked, setChecked] = useState(false);

  const done = async (message: string) => {
    await changed();
    toast.success(message);
    onDone();
  };
  const create = useMutation(
    trpc.admin.goals.create.mutationOptions({ onSuccess: () => done("Goal added.") }),
  );
  const update = useMutation(
    trpc.admin.goals.update.mutationOptions({ onSuccess: () => done("Goal saved.") }),
  );
  const saving = create.isPending || update.isPending;
  const failed = create.error ?? update.error;

  const targetNumber = Number(target.replace(/\s/g, "").replace(",", "."));
  const errors = {
    title: title.trim() ? null : "Give the goal a title.",
    target:
      target.trim() === "" || !Number.isFinite(targetNumber) || targetNumber <= 0
        ? "Enter a target above 0."
        : metric === "jobs" && !Number.isInteger(targetNumber)
          ? "Jobs are counted in whole numbers."
          : null,
    from: from ? null : "Pick the first day.",
    to: !to ? "Pick the last day." : from && to < from ? "The last day is before the first." : null,
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    setChecked(true);
    if (Object.values(errors).some(Boolean)) return;
    const fields = {
      companyId: company.id,
      title: title.trim(),
      metric,
      target: targetNumber,
      // Whole days in UTC: from the first moment of the first day to the last of the last.
      startAt: `${from}T00:00:00.000Z`,
      endAt: `${to}T23:59:59.999Z`,
    };
    if (goal) update.mutate({ ...fields, goalId: goal.id });
    else create.mutate(fields);
  }

  const id = goal?.id ?? "new";
  const unit = metric === "km" ? "km" : metric === "jobs" ? "jobs" : "income";
  return (
    <form
      onSubmit={submit}
      noValidate
      className="space-y-4 bg-[var(--row-highlight)] px-4 py-5 sm:px-5"
    >
      <h3 className="text-[15px] font-bold">{goal ? `Edit ${goal.title}` : "New goal"}</h3>
      <Field
        id={`goal-title-${id}`}
        label="Title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="100 000 km together"
        maxLength={80}
        autoFocus
        error={checked ? errors.title : null}
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          id={`goal-metric-${id}`}
          label="Counts"
          hint={
            metric === "income"
              ? "Job income as the games pay it: euros in ETS2 and dollars in ATS, added together."
              : undefined
          }
        >
          <Segmented label="Counts" options={METRICS} value={metric} onChange={setMetric} />
        </Field>
        <Field
          id={`goal-target-${id}`}
          label={`Target (${unit})`}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder={metric === "km" ? "100000" : metric === "jobs" ? "500" : "2000000"}
          inputMode="decimal"
          className="tabular"
          error={checked ? errors.target : null}
        />
        <Field
          id={`goal-from-${id}`}
          label="First day"
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          error={checked ? errors.from : null}
        />
        <Field
          id={`goal-to-${id}`}
          label="Last day"
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => setTo(e.target.value)}
          hint="Both days count in full, on the UTC clock."
          error={checked ? errors.to : null}
        />
      </div>
      {failed && (
        <p role="alert" className="text-[14px] text-destructive">
          {saveError(failed)}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : goal ? "Save goal" : "Add goal"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function DeleteGoal({
  company,
  goal,
  onDone,
}: {
  company: AdminCompany;
  goal: Goal;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const changed = useGoalsChanged(company);
  const remove = useMutation(
    trpc.admin.goals.delete.mutationOptions({
      onSuccess: async () => {
        await changed();
        toast.success("Goal deleted.");
        onDone();
      },
      onError: (e) => toast.error(saveError(e)),
    }),
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 bg-[var(--row-highlight)] px-4 py-4 sm:px-5">
      <p className="min-w-0 flex-1 basis-64 text-[14px] leading-relaxed">
        <span className="font-semibold">Delete {goal.title}?</span>{" "}
        <span className="text-muted-foreground">
          {goal.phase === "current" ? "It disappears from every driver's dashboard. " : ""}
          The jobs themselves stay.
        </span>
      </p>
      <div className="flex gap-2">
        <Button
          variant="destructive"
          disabled={remove.isPending}
          onClick={() => remove.mutate({ companyId: company.id, goalId: goal.id })}
        >
          {remove.isPending ? "Deleting…" : "Delete goal"}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={remove.isPending} autoFocus>
          Cancel
        </Button>
      </div>
    </div>
  );
}
