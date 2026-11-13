import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { removalBlock } from "@te-rebrand/api/membership-rules";
import { Button } from "@te-rebrand/ui/components/button";
import { UserMinus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  type AdminCompany,
  AdminHeader,
  AdminPage,
  loadError,
  Notice,
  RowsSkeleton,
} from "@/components/admin/admin-page";
import { actionError, formatDate, type Role, roleLabel, RolePill } from "@/components/company/bits";
import { formatDistance } from "@/lib/format";
import { useTRPC } from "@/utils/trpc";

// Everyone in the company: role, when they joined, and what they've driven for
// it. The owner changes roles; managers and the owner remove drivers.
export const Route = createFileRoute("/_auth/vtc/$slug/admin/members")({
  component: MembersTab,
});

function MembersTab() {
  const { slug } = Route.useParams();
  return (
    <AdminPage slug={slug}>{(company) => <Members company={company} slug={slug} />}</AdminPage>
  );
}

type Member = {
  id: string;
  role: Role;
  joinedAt: Date | string;
  you: boolean;
  kmInCompany: number;
  jobsInCompany: number;
  driver: { id: string; displayName: string };
};
const ROLE_ORDER: Record<Role, number> = { owner: 0, manager: 1, driver: 2 };

function Members({ company, slug }: { company: AdminCompany; slug: string }) {
  const trpc = useTRPC();
  const members = useQuery(trpc.company.members.queryOptions({ companyId: company.id }));
  const viewer = useQuery(trpc.company.viewer.queryOptions({ slug }, { retry: false }));
  const unit = viewer.data?.signedIn ? viewer.data.unit : "km";

  const rows = [...(members.data ?? [])].sort(
    (a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || b.kmInCompany - a.kmInCompany,
  );
  const myRole = rows.find((m) => m.you)?.role ?? null;

  return (
    <>
      <AdminHeader title="Members">
        Everyone driving for {company.name}, with the distance they've delivered here.{" "}
        {myRole === "owner"
          ? "You change roles and remove members."
          : "You can remove drivers; the owner changes roles."}
      </AdminHeader>

      {members.isError ? (
        <Notice>{loadError(members.error, "the members", company)}</Notice>
      ) : !members.data || !myRole ? (
        <RowsSkeleton rows={6} />
      ) : (
        <>
          <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
            {rows.map((m) => (
              <li key={m.id}>
                <MemberRow company={company} member={m} myRole={myRole} unit={unit} />
              </li>
            ))}
          </ul>
          <p className="tabular text-[13px] leading-relaxed text-muted-foreground">
            {rows.length} active {rows.length === 1 ? "member" : "members"}. Distance counts
            delivered jobs only. Drivers join through an application; members who leave the VTC on
            TruckersMP are set inactive by the nightly check.
          </p>
        </>
      )}
    </>
  );
}

function MemberRow({
  company,
  member: m,
  myRole,
  unit,
}: {
  company: AdminCompany;
  member: Member;
  myRole: Role;
  unit: "km" | "mi";
}) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const name = m.driver.displayName;
  const changed = () =>
    queryClient.invalidateQueries({
      queryKey: trpc.company.members.queryKey({ companyId: company.id }),
    });

  const setRole = useMutation(
    trpc.company.setMemberRole.mutationOptions({
      onSuccess: (_, input) => {
        toast.success(`${name} is now a ${roleLabel(input.role).toLowerCase()}.`);
        return changed();
      },
      onError: (e) => {
        toast.error(actionError(e, "The role didn't change. Try again."));
        return changed();
      },
    }),
  );
  const remove = useMutation(
    trpc.memberships.remove.mutationOptions({
      onSuccess: () => {
        toast.success(`${name} was removed from ${company.name}.`);
        return changed();
      },
      onError: (e) => {
        toast.error(actionError(e, "They weren't removed. Try again."));
        setConfirming(false);
        return changed();
      },
    }),
  );
  const busy = setRole.isPending || remove.isPending;
  const canChangeRole = myRole === "owner" && m.role !== "owner";
  const canRemove = removalBlock(myRole, m.role, m.you) === null;

  return (
    <div className="px-4 py-3.5 sm:px-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="min-w-0 flex-1 basis-40">
          <div className="truncate text-[15px] font-semibold">
            <Link
              to="/driver/$driverId"
              params={{ driverId: m.driver.id }}
              className="rounded-sm underline-offset-2 hover:underline"
            >
              {name}
            </Link>
            {m.you && <span className="font-normal text-muted-foreground"> (you)</span>}
          </div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            Joined {formatDate(m.joinedAt)}
          </div>
        </div>
        <div className="tabular w-28 shrink-0 text-right">
          <div className="text-[15px] font-semibold">{formatDistance(m.kmInCompany, unit)}</div>
          <div className="mt-0.5 text-[13px] text-muted-foreground">
            {m.jobsInCompany} {m.jobsInCompany === 1 ? "job" : "jobs"}
          </div>
        </div>
        <div className="flex w-full items-center justify-between gap-2 sm:w-60 sm:justify-end">
          {canChangeRole ? (
            <select
              aria-label={`Role of ${name}`}
              value={m.role}
              disabled={busy}
              onChange={(e) =>
                setRole.mutate({
                  companyId: company.id,
                  membershipId: m.id,
                  role: e.target.value as "manager" | "driver",
                })
              }
              className="h-9 rounded-lg border border-input bg-card px-2.5 text-[14px] font-semibold outline-none focus-visible:border-ring focus-visible:ring-1 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
            >
              <option value="driver">Driver</option>
              <option value="manager">Manager</option>
            </select>
          ) : (
            <RolePill role={m.role} />
          )}
          {canRemove ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy || confirming}
              onClick={() => setConfirming(true)}
            >
              <UserMinus /> Remove
            </Button>
          ) : (
            // Keeps the role column lined up on rows without a button.
            <span className="hidden w-[5.5rem] sm:block" />
          )}
        </div>
      </div>

      {confirming && (
        <div
          role="group"
          aria-label={`Remove ${name}?`}
          className="mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t pt-3"
        >
          <p className="min-w-0 flex-1 basis-56 text-[14px] leading-relaxed">
            <span className="font-semibold">
              Remove {name} from {company.name}?
            </span>{" "}
            <span className="text-muted-foreground">
              Their deliveries stay with the company. To come back they apply again.
            </span>
          </p>
          <div className="flex gap-2">
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => remove.mutate({ companyId: company.id, membershipId: m.id })}
            >
              {remove.isPending ? "Removing…" : "Remove member"}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirming(false)} autoFocus>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
