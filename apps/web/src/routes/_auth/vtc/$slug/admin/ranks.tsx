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
} from "@/components/admin/admin-page";
import { formatDistance } from "@/lib/format";
import { useTRPC } from "@/utils/trpc";

// The company's rank ladder. Thresholds are km driven for this company; they
// are entered and shown in km here, because that is what is stored.
export const Route = createFileRoute("/_auth/vtc/$slug/admin/ranks")({
  component: RanksTab,
});

function RanksTab() {
  const { slug } = Route.useParams();
  return <AdminPage slug={slug}>{(company) => <Ranks company={company} />}</AdminPage>;
}

type Rank = {
  id: string;
  name: string;
  minKm: number;
  discordRoleId: string | null;
  members: number;
};
/** Which row is open: a rank being edited or deleted, or the form for a new one. */
type Open = { kind: "new" } | { kind: "edit" | "delete"; id: string } | null;

function Ranks({ company }: { company: AdminCompany }) {
  const trpc = useTRPC();
  const [open, setOpen] = useState<Open>(null);
  const ladder = useQuery(trpc.admin.ranks.list.queryOptions({ companyId: company.id }));
  const ranks = ladder.data?.ranks ?? [];

  return (
    <>
      <AdminHeader
        title="Ranks"
        action={
          // One primary action at a time: while a form is open, its Save is it.
          ladder.data && open === null ? (
            <Button onClick={() => setOpen({ kind: "new" })}>
              <Plus /> Add rank
            </Button>
          ) : null
        }
      >
        Drivers move up by the distance they deliver for {company.name}. A rank is held from its
        distance on; the Discord bot hands out the role when a driver gets there.
      </AdminHeader>

      {ladder.isError ? (
        <Notice>{loadError(ladder.error, "the ranks", company)}</Notice>
      ) : !ladder.data ? (
        <RowsSkeleton rows={5} />
      ) : (
        <>
          {ranks.length === 0 && open === null ? (
            <Notice>
              No ranks yet. Add the first one, for example Rookie from 0 km, and every member starts
              there.
            </Notice>
          ) : (
            <ol className="divide-y overflow-hidden rounded-2xl border bg-card">
              {ranks.map((rank, i) => (
                <li key={rank.id}>
                  {open?.kind === "edit" && open.id === rank.id ? (
                    <RankForm company={company} rank={rank} onDone={() => setOpen(null)} />
                  ) : open?.kind === "delete" && open.id === rank.id ? (
                    <DeleteRank company={company} rank={rank} onDone={() => setOpen(null)} />
                  ) : (
                    <RankRow
                      step={i + 1}
                      rank={rank}
                      onEdit={() => setOpen({ kind: "edit", id: rank.id })}
                      onDelete={() => setOpen({ kind: "delete", id: rank.id })}
                    />
                  )}
                </li>
              ))}
              {open?.kind === "new" && (
                <li>
                  <RankForm company={company} onDone={() => setOpen(null)} />
                </li>
              )}
            </ol>
          )}
          {ranks.length > 0 && (
            <p className="tabular text-[13px] text-muted-foreground">
              {ladder.data.members} active {ladder.data.members === 1 ? "member" : "members"}
              {ladder.data.unranked > 0 &&
                `, ${ladder.data.unranked} still below ${formatDistance(ranks[0]!.minKm, "km")} and without a rank`}
              . Changing a distance moves members straight away, without a rank-up message.
            </p>
          )}
        </>
      )}
    </>
  );
}

function RankRow({
  step,
  rank,
  onEdit,
  onDelete,
}: {
  step: number;
  rank: Rank;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5 sm:gap-4 sm:px-5">
      <span className="tabular w-5 shrink-0 text-[13px] text-muted-foreground">{step}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {/* Rank pills are neutral (DESIGN.md). */}
          <span className="inline-flex h-6 max-w-full items-center truncate rounded-full bg-secondary px-2.5 text-[13px] font-semibold">
            {rank.name}
          </span>
          <span className="tabular text-[14px] font-semibold">
            from {formatDistance(rank.minKm, "km")}
          </span>
        </div>
        <div className="tabular mt-1 truncate text-[13px] text-muted-foreground">
          {rank.members} {rank.members === 1 ? "member" : "members"}
          {" · "}
          {rank.discordRoleId ? `Discord role ${rank.discordRoleId}` : "No Discord role"}
        </div>
      </div>
      <div className="flex shrink-0 gap-1">
        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${rank.name}`} onClick={onEdit}>
          <Pencil />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Delete ${rank.name}`}
          onClick={onDelete}
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

function useRanksChanged(company: AdminCompany) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return () =>
    queryClient.invalidateQueries({
      queryKey: trpc.admin.ranks.list.queryKey({ companyId: company.id }),
    });
}

function RankForm({
  company,
  rank,
  onDone,
}: {
  company: AdminCompany;
  rank?: Rank;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const changed = useRanksChanged(company);
  const [name, setName] = useState(rank?.name ?? "");
  const [minKm, setMinKm] = useState(rank ? String(rank.minKm) : "");
  const [roleId, setRoleId] = useState(rank?.discordRoleId ?? "");
  const [checked, setChecked] = useState(false);

  const done = async (message: string) => {
    await changed();
    toast.success(message);
    onDone();
  };
  const create = useMutation(
    trpc.admin.ranks.create.mutationOptions({ onSuccess: () => done("Rank added.") }),
  );
  const update = useMutation(
    trpc.admin.ranks.update.mutationOptions({ onSuccess: () => done("Rank saved.") }),
  );
  const saving = create.isPending || update.isPending;
  const failed = create.error ?? update.error;

  const km = Number(minKm.replace(",", "."));
  const errors = {
    name: name.trim() ? null : "Give the rank a name.",
    minKm:
      minKm.trim() === "" || !Number.isFinite(km) || km < 0
        ? "Enter a distance in km, 0 or more."
        : null,
    roleId:
      roleId.trim() === "" || /^\d{5,25}$/.test(roleId.trim())
        ? null
        : "A role ID is a long number, like 1234567890123456789.",
  };

  function submit(e: FormEvent) {
    e.preventDefault();
    setChecked(true);
    if (errors.name || errors.minKm || errors.roleId) return;
    const fields = {
      companyId: company.id,
      name: name.trim(),
      minKm: km,
      discordRoleId: roleId.trim() || null,
    };
    if (rank) update.mutate({ ...fields, rankId: rank.id });
    else create.mutate(fields);
  }

  const id = rank?.id ?? "new";
  return (
    <form
      onSubmit={submit}
      noValidate
      className="space-y-4 bg-[var(--row-highlight)] px-4 py-5 sm:px-5"
    >
      <h3 className="text-[15px] font-bold">{rank ? `Edit ${rank.name}` : "New rank"}</h3>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Field
          id={`rank-name-${id}`}
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Senior Driver"
          maxLength={40}
          autoFocus
          error={checked ? errors.name : null}
        />
        <Field
          id={`rank-km-${id}`}
          label="From (km)"
          value={minKm}
          onChange={(e) => setMinKm(e.target.value)}
          placeholder="15000"
          inputMode="decimal"
          className="tabular"
          error={checked ? errors.minKm : null}
        />
        <Field
          id={`rank-role-${id}`}
          label="Discord role ID (optional)"
          value={roleId}
          onChange={(e) => setRoleId(e.target.value)}
          placeholder="1234567890123456789"
          inputMode="numeric"
          className="tabular"
          error={checked ? errors.roleId : null}
        />
      </div>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        To copy a role ID: in Discord, turn on Developer Mode (User Settings, Advanced), then
        right-click the role under Server Settings, Roles and choose Copy Role ID.
      </p>
      {failed && (
        <p role="alert" className="text-[14px] text-destructive">
          {saveError(failed)}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? "Saving…" : rank ? "Save rank" : "Add rank"}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone} disabled={saving}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function DeleteRank({
  company,
  rank,
  onDone,
}: {
  company: AdminCompany;
  rank: Rank;
  onDone: () => void;
}) {
  const trpc = useTRPC();
  const changed = useRanksChanged(company);
  const remove = useMutation(
    trpc.admin.ranks.delete.mutationOptions({
      onSuccess: async () => {
        await changed();
        toast.success(`${rank.name} deleted.`);
        onDone();
      },
      onError: (e) => toast.error(saveError(e)),
    }),
  );
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 bg-[var(--row-highlight)] px-4 py-3.5 sm:px-5">
      <p className="min-w-0 flex-1 basis-64 text-[14px] leading-relaxed">
        <span className="font-semibold">Delete {rank.name}?</span>{" "}
        <span className="text-muted-foreground">
          {rank.members === 0
            ? "Nobody holds it right now."
            : `${rank.members} ${rank.members === 1 ? "member drops" : "members drop"} to the rank below.`}{" "}
          Discord roles already given stay until you remove them.
        </span>
      </p>
      <div className="flex gap-2">
        <Button
          variant="destructive"
          disabled={remove.isPending}
          onClick={() => remove.mutate({ companyId: company.id, rankId: rank.id })}
        >
          {remove.isPending ? "Deleting…" : "Delete rank"}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={remove.isPending} autoFocus>
          Cancel
        </Button>
      </div>
    </div>
  );
}
