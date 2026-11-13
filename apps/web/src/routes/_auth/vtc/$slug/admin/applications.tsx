import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@te-rebrand/ui/components/button";
import { Input } from "@te-rebrand/ui/components/input";
import { Check, Plus, Trash2, X } from "lucide-react";
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
import { actionError } from "@/components/company/bits";
import { formatWhen } from "@/lib/format";
import { useTRPC } from "@/utils/trpc";

// Recruitment: the applications waiting for an answer, and the form drivers
// fill in on the public company page.
export const Route = createFileRoute("/_auth/vtc/$slug/admin/applications")({
  component: ApplicationsTab,
});

function ApplicationsTab() {
  const { slug } = Route.useParams();
  return (
    <AdminPage slug={slug}>
      {(company) => (
        <>
          <Pending company={company} />
          <RecruitmentForm company={company} />
        </>
      )}
    </AdminPage>
  );
}

type Application = {
  id: string;
  createdAt: Date | string;
  driver: { id: string; displayName: string; steamLinked: boolean };
  answers: { question: string; answer: string }[];
};

function Pending({ company }: { company: AdminCompany }) {
  const trpc = useTRPC();
  const input = { companyId: company.id };
  const pending = useQuery(trpc.applications.pending.queryOptions(input));
  const form = useQuery(trpc.applications.form.queryOptions(input));

  return (
    <>
      <AdminHeader title="Applications">
        Drivers who sent the recruitment form of {company.name}. Accepting makes them a driver here;
        Tacho first checks on TruckersMP that they're in your VTC.
      </AdminHeader>

      {pending.isError ? (
        <Notice>{loadError(pending.error, "the applications", company)}</Notice>
      ) : !pending.data ? (
        <RowsSkeleton rows={3} />
      ) : pending.data.length === 0 ? (
        <Notice>
          No applications waiting.{" "}
          {form.data && !form.data.open
            ? "Recruitment is closed, so the form isn't on your company page. Open it below."
            : "New ones show up here as drivers apply."}
        </Notice>
      ) : (
        <ul className="space-y-3">
          {pending.data.map((a) => (
            <li key={a.id}>
              <ApplicationCard company={company} application={a} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ApplicationCard({
  company,
  application: a,
}: {
  company: AdminCompany;
  application: Application;
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [confirmReject, setConfirmReject] = useState(false);
  const name = a.driver.displayName;
  const decided = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: trpc.applications.pending.queryKey({ companyId: company.id }),
      }),
      queryClient.invalidateQueries({
        queryKey: trpc.company.members.queryKey({ companyId: company.id }),
      }),
    ]);

  const accept = useMutation(
    trpc.applications.accept.mutationOptions({
      onSuccess: () => {
        toast.success(`${name} is now a driver of ${company.name}.`);
        return decided();
      },
      // The reason stays on the card (below): it usually says what the
      // applicant has to do first, and a toast would be gone too soon.
      onError: (e) => (e.data?.code === "NOT_FOUND" ? decided() : undefined),
    }),
  );
  const reject = useMutation(
    trpc.applications.reject.mutationOptions({
      onSuccess: () => {
        toast.success(`${name}'s application was rejected.`);
        return decided();
      },
      onError: (e) => {
        toast.error(actionError(e, "That didn't work. Try again."));
        return decided();
      },
    }),
  );
  const busy = accept.isPending || reject.isPending;
  const ids = { companyId: company.id, applicationId: a.id };

  return (
    <article className="space-y-4 rounded-2xl border bg-card p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="min-w-0 truncate text-[17px] font-bold tracking-tight">{name}</h3>
        <p className="text-[13px] text-muted-foreground">Applied {formatWhen(a.createdAt)}</p>
      </header>

      {a.answers.length === 0 ? (
        <p className="text-[14px] text-muted-foreground">The form had no questions.</p>
      ) : (
        <dl className="space-y-3">
          {a.answers.map((qa, i) => (
            <div key={i}>
              <dt className="text-[13px] text-muted-foreground">{qa.question}</dt>
              <dd className="mt-0.5 text-[15px] leading-relaxed break-words whitespace-pre-wrap">
                {qa.answer}
              </dd>
            </div>
          ))}
        </dl>
      )}

      {!a.driver.steamLinked && (
        <p className="text-[13px] leading-relaxed text-destructive">
          {name} has no Steam account linked any more, so TruckersMP can't be checked.
        </p>
      )}
      {accept.isError && (
        <p role="alert" className="text-[14px] leading-relaxed text-destructive">
          {actionError(accept.error, "Couldn't accept the application. Try again.")}
        </p>
      )}

      {confirmReject ? (
        <div
          role="group"
          aria-label={`Reject ${name}?`}
          className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t pt-4"
        >
          <p className="min-w-0 flex-1 basis-56 text-[14px] leading-relaxed">
            <span className="font-semibold">Reject {name}'s application?</span>{" "}
            <span className="text-muted-foreground">They can apply again later.</span>
          </p>
          <div className="flex gap-2">
            <Button variant="destructive" disabled={busy} onClick={() => reject.mutate(ids)}>
              {reject.isPending ? "Rejecting…" : "Reject application"}
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
        <div className="flex gap-2 border-t pt-4">
          <Button variant="outline" disabled={busy} onClick={() => accept.mutate(ids)}>
            <Check className="text-success" />{" "}
            {accept.isPending ? "Checking TruckersMP…" : "Accept"}
          </Button>
          <Button variant="ghost" disabled={busy} onClick={() => setConfirmReject(true)}>
            <X /> Reject
          </Button>
        </div>
      )}
    </article>
  );
}

const MAX_QUESTIONS = 10;
const OPEN_OPTIONS = [
  { value: "open", label: "Open" },
  { value: "closed", label: "Closed" },
] as const;
type Draft = { open: boolean; questions: string[] };

function RecruitmentForm({ company }: { company: AdminCompany }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const input = { companyId: company.id };
  const saved = useQuery(trpc.applications.form.queryOptions(input));
  // null until the manager changes something; then their unsaved version.
  const [draft, setDraft] = useState<Draft | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const save = useMutation(
    trpc.applications.setForm.mutationOptions({
      onSuccess: async (form) => {
        queryClient.setQueryData(trpc.applications.form.queryKey(input), form);
        setDraft(null);
        setShowErrors(false);
        toast.success(
          form.open ? "Saved. The form is on your company page." : "Saved. Recruitment is closed.",
        );
        await queryClient.invalidateQueries({
          queryKey: trpc.company.page.queryKey({ slug: company.slug }),
        });
      },
    }),
  );

  const heading = (
    <div className="space-y-2 border-t pt-8">
      <h3 className="text-xl font-bold tracking-tight">Recruitment form</h3>
      <p className="max-w-xl text-[15px] leading-relaxed text-muted-foreground">
        What drivers answer when they apply on your{" "}
        <Link
          to="/vtc/$slug"
          params={{ slug: company.slug }}
          className="font-medium text-signal-ink underline-offset-2 hover:underline"
        >
          company page
        </Link>
        . While recruitment is closed the form isn't shown.
      </p>
    </div>
  );

  if (saved.isError) {
    return (
      <>
        {heading}
        <Notice>{loadError(saved.error, "the recruitment form", company)}</Notice>
      </>
    );
  }
  if (!saved.data) {
    return (
      <>
        {heading}
        <RowsSkeleton rows={2} />
      </>
    );
  }

  const form = draft ?? saved.data;
  const dirty = draft !== null;
  const change = (next: Partial<Draft>) => setDraft({ ...form, ...next });
  const empty = (q: string) => q.trim().length === 0;

  function submit(e: FormEvent) {
    e.preventDefault();
    if (form.questions.some(empty)) {
      setShowErrors(true);
      return;
    }
    save.mutate({ ...input, open: form.open, questions: form.questions.map((q) => q.trim()) });
  }

  return (
    <>
      {heading}
      <form onSubmit={submit} noValidate className="space-y-6 rounded-2xl border bg-card p-5">
        {/* Not a <label>: the two buttons are the control, named by their group. */}
        <div className="space-y-2">
          <p className="text-[13px] font-semibold">Recruitment</p>
          <Segmented
            label="Recruitment"
            options={OPEN_OPTIONS}
            value={form.open ? "open" : "closed"}
            onChange={(v) => change({ open: v === "open" })}
            disabled={save.isPending}
          />
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            {form.open
              ? "Open: anyone logged in with Steam linked can apply."
              : "Closed: nobody can apply. Applications already sent stay in the list above."}
          </p>
        </div>

        <div className="space-y-4">
          {form.questions.length === 0 && (
            <p className="text-[14px] leading-relaxed text-muted-foreground">
              No questions. Drivers apply with one click, and you decide from their name alone.
            </p>
          )}
          {form.questions.map((question, i) => (
            <Field
              key={i}
              id={`question-${i}`}
              label={`Question ${i + 1}`}
              error={showErrors && empty(question) ? "Write the question, or remove it." : null}
            >
              <div className="flex gap-2">
                <Input
                  id={`question-${i}`}
                  value={question}
                  maxLength={200}
                  disabled={save.isPending}
                  placeholder="Why do you want to drive with us?"
                  aria-invalid={showErrors && empty(question) ? true : undefined}
                  onChange={(e) =>
                    change({
                      questions: form.questions.map((q, j) => (j === i ? e.target.value : q)),
                    })
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11 shrink-0"
                  aria-label={`Remove question ${i + 1}`}
                  disabled={save.isPending}
                  onClick={() => change({ questions: form.questions.filter((_, j) => j !== i) })}
                >
                  <Trash2 />
                </Button>
              </div>
            </Field>
          ))}
          <Button
            type="button"
            variant="outline"
            disabled={save.isPending || form.questions.length >= MAX_QUESTIONS}
            onClick={() => change({ questions: [...form.questions, ""] })}
          >
            <Plus /> Add question
          </Button>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Up to {MAX_QUESTIONS} questions. Changing them doesn't change applications already sent:
            each keeps the questions it answered.
          </p>
        </div>

        {save.isError && (
          <p role="alert" className="text-[14px] text-destructive">
            {saveError(save.error)}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2 border-t pt-5">
          <Button type="submit" disabled={!dirty || save.isPending}>
            {save.isPending ? "Saving…" : "Save form"}
          </Button>
          {dirty && (
            <Button
              type="button"
              variant="ghost"
              disabled={save.isPending}
              onClick={() => {
                setDraft(null);
                setShowErrors(false);
              }}
            >
              Discard changes
            </Button>
          )}
        </div>
      </form>
    </>
  );
}
