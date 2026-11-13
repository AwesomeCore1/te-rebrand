import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { Skeleton } from "@te-rebrand/ui/components/skeleton";
import { ArrowLeft } from "lucide-react";

import { Notice } from "@/components/admin/admin-page";
import { CompanyLogo, roleLabel } from "@/components/company/bits";
import { useTRPC } from "@/utils/trpc";

// The frame of the company admin: the company as the page heading, the six
// tabs, and the tab's own page below. Managers and owners only. The API checks
// that on every call (companyProcedure); here it only decides what to show.
export const Route = createFileRoute("/_auth/vtc/$slug/admin")({
  component: AdminLayout,
});

const TABS = [
  { to: "/vtc/$slug/admin/members", label: "Members" },
  { to: "/vtc/$slug/admin/applications", label: "Applications" },
  { to: "/vtc/$slug/admin/ranks", label: "Ranks" },
  { to: "/vtc/$slug/admin/goals", label: "Goals" },
  { to: "/vtc/$slug/admin/jobs", label: "Jobs" },
  { to: "/vtc/$slug/admin/settings", label: "Settings" },
] as const;

function AdminLayout() {
  const { slug } = Route.useParams();
  const trpc = useTRPC();
  const company = useQuery(trpc.company.bySlug.queryOptions({ slug }, { retry: false }));
  const viewer = useQuery(trpc.company.viewer.queryOptions({ slug }, { retry: false }));

  const membership = viewer.data?.signedIn ? viewer.data.membership : null;
  const role = membership?.here ? membership.role : null;
  const allowed = role === "owner" || role === "manager";
  // The number on the Applications tab. Only asked once we know they may see it.
  const pending = useQuery(
    trpc.applications.pending.queryOptions(
      { companyId: company.data?.id ?? "" },
      { enabled: allowed && Boolean(company.data), retry: false },
    ),
  );
  const waiting = pending.data?.length ?? 0;

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 px-5 pt-28 pb-16 md:px-8">
      <header className="space-y-4">
        <Link
          to="/vtc/$slug"
          params={{ slug }}
          className="inline-flex items-center gap-1.5 rounded-md text-[14px] font-medium text-signal-ink underline-offset-2 hover:underline"
        >
          <ArrowLeft className="size-4" aria-hidden="true" /> Company page
        </Link>
        {company.data ? (
          <div className="flex items-center gap-4">
            <CompanyLogo
              name={company.data.name}
              tag={company.data.tag}
              logoUrl={company.data.logoUrl}
              className="size-12 text-base"
            />
            <div className="min-w-0">
              <h1 className="truncate text-[clamp(1.5rem,3vw,2rem)] leading-tight font-extrabold">
                {company.data.name}
              </h1>
              <p className="text-[14px] text-muted-foreground">
                Company admin
                {role
                  ? ` · you're ${role === "owner" ? "the" : "a"} ${roleLabel(role).toLowerCase()}`
                  : ""}
              </p>
            </div>
          </div>
        ) : company.isError ? (
          <h1 className="text-[clamp(1.5rem,3vw,2rem)] leading-tight font-extrabold">
            Company admin
          </h1>
        ) : (
          <div className="flex items-center gap-4" aria-busy="true">
            <Skeleton className="size-12 rounded-2xl" />
            <div className="space-y-2">
              <Skeleton className="h-7 w-56" />
              <Skeleton className="h-4 w-36" />
            </div>
          </div>
        )}
      </header>

      {company.isError ? (
        <Notice>
          {company.error.data?.code === "NOT_FOUND"
            ? "There is no company at this address."
            : "Couldn't load the company. Reload the page."}
        </Notice>
      ) : viewer.isError ? (
        <Notice>Couldn't check your role in this company. Reload the page.</Notice>
      ) : !viewer.data || !company.data ? (
        <div className="flex gap-2" aria-busy="true">
          {TABS.map((t) => (
            <Skeleton key={t.to} className="h-9 w-24 shrink-0 rounded-full" />
          ))}
        </div>
      ) : !allowed ? (
        <Notice>
          Only managers and the owner of {company.data.name} can open the company admin.
          {role === "driver" ? " You're a driver here." : " You're not a member of this company."}
        </Notice>
      ) : (
        <>
          {/* Scrolls sideways on a phone instead of wrapping into two rows. */}
          <nav
            aria-label="Company admin"
            className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1 md:mx-0 md:px-0"
          >
            {TABS.map((tab) => (
              <Link
                key={tab.to}
                to={tab.to}
                params={{ slug }}
                className="inline-flex h-9 shrink-0 items-center gap-2 rounded-full bg-secondary px-4 text-[14px] font-semibold text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60"
                activeProps={{
                  className: "bg-primary! text-primary-foreground! hover:text-primary-foreground!",
                  "aria-current": "page",
                }}
              >
                {tab.label}
                {tab.label === "Applications" && waiting > 0 && (
                  <span
                    className="tabular inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-card px-1.5 text-[12px] font-bold text-foreground"
                    aria-label={`${waiting} waiting`}
                  >
                    {waiting}
                  </span>
                )}
              </Link>
            ))}
          </nav>
          <Outlet />
        </>
      )}
    </main>
  );
}
