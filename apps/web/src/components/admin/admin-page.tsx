// The frame every company admin tab stands in. The tab layout
// (routes/_auth/vtc/$slug/admin/route.tsx) brings the page shell and the tabs;
// without it, a tab is a page of its own. Either way the company is looked up
// from the slug here and the tab gets it once it is known.
import { useQuery } from "@tanstack/react-query";
import { useMatches } from "@tanstack/react-router";
import { Input } from "@te-rebrand/ui/components/input";
import { Label } from "@te-rebrand/ui/components/label";
import { Skeleton } from "@te-rebrand/ui/components/skeleton";
import type { ComponentProps, ReactNode } from "react";

import { useTRPC } from "@/utils/trpc";

const LAYOUT_ROUTE = "/_auth/vtc/$slug/admin";

export type AdminCompany = { id: string; name: string; slug: string };

function useInsideLayout() {
  return useMatches({ select: (ms) => ms.some((m) => (m.routeId as string) === LAYOUT_ROUTE) });
}

export function AdminPage({
  slug,
  children,
}: {
  slug: string;
  children: (company: AdminCompany) => ReactNode;
}) {
  const trpc = useTRPC();
  const insideLayout = useInsideLayout();
  const company = useQuery(trpc.company.bySlug.queryOptions({ slug }, { retry: false }));

  const body = company.data ? (
    children(company.data)
  ) : company.isError ? (
    <Notice>
      {company.error.data?.code === "NOT_FOUND"
        ? "There is no company at this address."
        : "Couldn't load the company. Reload the page."}
    </Notice>
  ) : (
    <ListSkeleton />
  );

  if (insideLayout) return <div className="space-y-6">{body}</div>;
  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-5 pt-28 pb-16 md:px-8">{body}</main>
  );
}

/** Title, one line of explanation and the tab's main action. */
export function AdminHeader({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  // The layout has the page's h1 (the company); on its own, the tab is the page.
  const insideLayout = useInsideLayout();
  const Heading = insideLayout ? "h2" : "h1";
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      <div className="min-w-0">
        <Heading
          className={`leading-none font-extrabold ${insideLayout ? "text-2xl" : "text-[clamp(1.75rem,3.5vw,2.25rem)]"}`}
        >
          {title}
        </Heading>
        <p className="mt-2.5 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
          {children}
        </p>
      </div>
      {action}
    </header>
  );
}

export function Notice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-2xl border bg-card px-5 py-8 text-[15px] leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="space-y-3">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <RowsSkeleton rows={rows} />
    </div>
  );
}

export function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="divide-y overflow-hidden rounded-2xl border bg-card" aria-busy="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-5 py-4">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="ml-auto h-5 w-24" />
        </div>
      ))}
    </div>
  );
}

type ApiError = { message: string; data?: { code?: string } | null };

/** What to say when a tab's own data does not load. */
export function loadError(error: ApiError, what: string, company: AdminCompany) {
  return error.data?.code === "FORBIDDEN"
    ? `Only managers and owners of ${company.name} can see ${what}.`
    : `Couldn't load ${what}. Reload the page.`;
}

/** Errors the API words itself are shown as they are; the rest get a plain line. */
export function saveError(error: ApiError) {
  const code = error.data?.code;
  if (code === "CONFLICT" || code === "NOT_FOUND") return error.message;
  if (code === "FORBIDDEN") return "You're not allowed to change this.";
  if (code === "BAD_REQUEST" && !error.message.trimStart().startsWith("[")) return error.message;
  if (code === "BAD_REQUEST") return "Some fields aren't right. Check them and save again.";
  return "That didn't save. Try again.";
}

/** A labelled input: label above, hint or error below. */
export function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
  ...input
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string | null;
  /** Replaces the input, for a textarea or a group of buttons. */
  children?: ReactNode;
} & ComponentProps<typeof Input>) {
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className={`min-w-0 space-y-2 ${className ?? ""}`}>
      <Label htmlFor={id} className="text-[13px] font-semibold">
        {label}
      </Label>
      {children ?? (
        <Input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          {...input}
        />
      )}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-[13px] text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-[13px] leading-relaxed text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** A small set of choices where one is on, like the km/mi switch on the dashboard. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  disabled?: boolean;
}) {
  return (
    <div
      className="flex w-fit max-w-full rounded-lg border bg-card p-1"
      role="group"
      aria-label={label}
    >
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          disabled={disabled}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-8 rounded-md px-3 text-sm font-semibold whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring/60 disabled:opacity-60 ${
            value === o.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
