import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@te-rebrand/ui/components/button";
import { Skeleton } from "@te-rebrand/ui/components/skeleton";
import { ExternalLink, RefreshCw } from "lucide-react";
import { type ReactNode, useState } from "react";
import { toast } from "sonner";

import { actionError, CompanyLogo } from "@/components/company/bits";
import { useTRPC } from "@/utils/trpc";

// Registering a company. Nobody types a VTC id: Tacho asks TruckersMP which VTC
// the driver's Steam account is in and whether they run it, and offers exactly
// that one. So nobody can claim someone else's VTC.
export const Route = createFileRoute("/_auth/vtc/new")({
  component: NewCompany,
});

const TRUCKERSMP_VTCS = "https://truckersmp.com/vtc";

function NewCompany() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const navigate = Route.useNavigate();
  // After "Check again", TruckersMP is asked afresh instead of from the cache.
  const [fresh, setFresh] = useState(false);
  const check = useQuery(trpc.company.registration.queryOptions({ fresh }, { retry: false }));
  const create = useMutation(
    trpc.company.create.mutationOptions({
      onSuccess: async (company) => {
        toast.success(`${company.name} is on Tacho.`);
        await queryClient.invalidateQueries();
        await navigate({ to: "/vtc/$slug", params: { slug: company.slug } });
      },
    }),
  );

  const again = (
    <Button
      variant="outline"
      disabled={check.isFetching}
      onClick={() => (fresh ? void check.refetch() : setFresh(true))}
    >
      <RefreshCw className={check.isFetching ? "animate-spin motion-reduce:animate-none" : ""} />
      {check.isFetching ? "Checking…" : "Check again"}
    </Button>
  );

  return (
    <main className="mx-auto w-full max-w-xl px-5 pt-28 pb-16 md:pt-32">
      <div className="space-y-6 rounded-[24px] border bg-card p-6 md:p-9">
        <div className="space-y-2">
          <h1 className="text-3xl font-extrabold">Register your VTC</h1>
          <p className="text-[15px] leading-relaxed text-muted-foreground">
            A company on Tacho is a VTC on TruckersMP, registered by its owner. Tacho checks that
            with TruckersMP through your Steam account.
          </p>
        </div>

        {check.isError ? (
          <State title="The check didn't run" action={again}>
            Couldn't check your account. Try again.
          </State>
        ) : !check.data ? (
          <div className="space-y-3" aria-busy="true">
            <p className="text-[14px] text-muted-foreground">Asking TruckersMP…</p>
            <Skeleton className="h-20 w-full rounded-2xl" />
            <Skeleton className="h-10 w-40" />
          </div>
        ) : (
          <Result
            status={check.data}
            again={again}
            create={() => {
              if (check.data.status === "ready") create.mutate({ vtcId: check.data.vtc.id });
            }}
            creating={create.isPending}
            createError={
              create.isError
                ? actionError(create.error, "Couldn't register the company. Try again.")
                : null
            }
          />
        )}
      </div>
    </main>
  );
}

type Vtc = {
  id: number;
  name: string;
  tag: string | null;
  logo: string | null;
  membersCount: number | null;
  url: string;
};
type Status =
  | { status: "has_company"; company: { name: string; slug: string } }
  | { status: "steam_not_linked" | "unavailable" | "no_truckersmp_account" }
  | { status: "not_in_vtc"; playerName: string }
  | { status: "already_registered"; vtc: Vtc; company: { name: string; slug: string } }
  | { status: "not_owner"; vtc: Vtc; ownerName: string | null }
  | { status: "ready"; vtc: Vtc; playerName: string };

function Result({
  status: s,
  again,
  create,
  creating,
  createError,
}: {
  status: Status;
  again: ReactNode;
  create: () => void;
  creating: boolean;
  createError: string | null;
}) {
  switch (s.status) {
    case "steam_not_linked":
      return (
        <State
          title="Link Steam first"
          action={
            // A plain link: a full-page redirect to Steam, not an API call.
            <a href="/api/steam/connect">
              <Button>Connect Steam</Button>
            </a>
          }
        >
          Your Steam account is how Tacho finds you on TruckersMP. You come back to your dashboard
          afterwards; open this page again from there.
        </State>
      );
    case "unavailable":
      return (
        <State title="TruckersMP didn't answer" action={again}>
          Couldn't reach TruckersMP right now. Nothing was created. Try again in a minute.
        </State>
      );
    case "no_truckersmp_account":
      return (
        <State title="No TruckersMP account" action={again}>
          Your linked Steam account has no account on TruckersMP. Create one there with the same
          Steam account, create or join your VTC, and check again.
        </State>
      );
    case "not_in_vtc":
      return (
        <State title="You're not in a VTC" action={again}>
          You're on TruckersMP as {s.playerName}, but not in a VTC. Create your VTC on{" "}
          <Out href={TRUCKERSMP_VTCS}>truckersmp.com</Out> first, then check again. Companies that
          aren't on TruckersMP can't sign up yet.
        </State>
      );
    case "has_company":
      return (
        <State
          title={`You're in ${s.company.name}`}
          action={
            <Link to="/vtc/$slug" params={{ slug: s.company.slug }}>
              <Button variant="outline">Open {s.company.name}</Button>
            </Link>
          }
        >
          A driver has one company at a time, like on TruckersMP. Leave {s.company.name} before you
          register another.
        </State>
      );
    case "already_registered":
      return (
        <State
          vtc={s.vtc}
          title={`${s.vtc.name} is already on Tacho`}
          action={
            <Link to="/vtc/$slug" params={{ slug: s.company.slug }}>
              <Button>Open the company page</Button>
            </Link>
          }
        >
          Your VTC was registered by its owner. Open its page to apply as a driver.
        </State>
      );
    case "not_owner":
      return (
        <State vtc={s.vtc} title="Only the owner can register it" action={again}>
          You're a member of {s.vtc.name} on TruckersMP, not its owner.{" "}
          {s.ownerName
            ? `Ask ${s.ownerName} to register it here.`
            : "Ask the owner to register it."}{" "}
          Once it's on Tacho you can apply from its page.
        </State>
      );
    case "ready":
      return (
        <State
          vtc={s.vtc}
          title="You own this VTC"
          action={
            <Button onClick={create} disabled={creating}>
              {creating ? "Registering…" : `Register ${s.vtc.name}`}
            </Button>
          }
          error={createError}
        >
          TruckersMP confirms that you ({s.playerName}) run this VTC. The name, tag and logo are
          copied from there. You become the owner here, and your deliveries start counting for the
          company.
        </State>
      );
  }
}

function Out({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-medium text-signal-ink underline-offset-2 hover:underline"
    >
      {children}
      <ExternalLink className="size-3.5" aria-hidden="true" />
    </a>
  );
}

/** One outcome of the check: the VTC it is about (if any), what it means, and what to do next. */
function State({
  vtc,
  title,
  children,
  action,
  error,
}: {
  vtc?: Vtc;
  title: string;
  children: ReactNode;
  action: ReactNode;
  error?: string | null;
}) {
  return (
    <div className="space-y-5 border-t pt-6">
      {vtc && (
        <div className="flex items-center gap-4">
          <CompanyLogo
            name={vtc.name}
            tag={vtc.tag}
            logoUrl={vtc.logo}
            className="size-14 text-lg"
          />
          <div className="min-w-0">
            <div className="text-[17px] leading-snug font-bold tracking-tight break-words">
              {vtc.name}
              {vtc.tag && <span className="font-normal text-muted-foreground"> [{vtc.tag}]</span>}
            </div>
            <div className="tabular mt-0.5 flex flex-wrap gap-x-3 text-[13px] text-muted-foreground">
              {vtc.membersCount !== null && (
                <span>
                  {vtc.membersCount} {vtc.membersCount === 1 ? "member" : "members"} on TruckersMP
                </span>
              )}
              <Out href={vtc.url}>VTC #{vtc.id}</Out>
            </div>
          </div>
        </div>
      )}
      <div className="space-y-2">
        <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        <p className="text-[15px] leading-relaxed text-muted-foreground">{children}</p>
      </div>
      {error && (
        <p role="alert" className="text-[14px] text-destructive">
          {error}
        </p>
      )}
      <div>{action}</div>
    </div>
  );
}
