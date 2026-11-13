import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Button, buttonVariants } from "@te-rebrand/ui/components/button";
import { Textarea } from "@te-rebrand/ui/components/textarea";
import { cn } from "@te-rebrand/ui/lib/utils";
import { ExternalLink } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";
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
import { Markdown } from "@/components/markdown";
import { getDiscordClientId } from "@/functions/get-discord-client-id";
import { botInviteUrl, isDiscordId } from "@/lib/discord";
import { useTRPC } from "@/utils/trpc";

// Company settings: what the public page says about the company, and where
// the Discord bot posts. Owners change them; managers can read them. The
// recruitment form has its own tab and is not touched from here.
export const Route = createFileRoute("/_auth/vtc/$slug/admin/settings")({
  component: SettingsTab,
});

function SettingsTab() {
  const { slug } = Route.useParams();
  return <AdminPage slug={slug}>{(company) => <Settings company={company} />}</AdminPage>;
}

const ABOUT_MAX = 4000;
const CHANNELS = [
  {
    key: "deliveryChannelId",
    label: "Delivery feed channel ID",
    hint: "A message for every delivered job.",
  },
  {
    key: "rankUpChannelId",
    label: "Rank-up channel ID",
    hint: "A message when a driver reaches a new rank.",
  },
  {
    key: "eventChannelId",
    label: "Convoy reminder channel ID",
    hint: "Reminders before your convoys on TruckersMP.",
  },
  {
    key: "monthlyChannelId",
    label: "Monthly winners channel ID",
    hint: "The top drivers at the end of each month.",
  },
] as const;
type ChannelKey = (typeof CHANNELS)[number]["key"];

type Loaded = {
  name: string;
  slug: string;
  tag: string | null;
  logoUrl: string | null;
  discordGuildId: string | null;
  about: string;
  discord: Record<ChannelKey, string | null>;
  canEdit: boolean;
};

function Settings({ company }: { company: AdminCompany }) {
  const trpc = useTRPC();
  const settings = useQuery(trpc.admin.settings.get.queryOptions({ companyId: company.id }));

  return (
    <>
      <AdminHeader title="Settings">
        How {company.name} appears on Tacho, and where the Discord bot posts.
        {settings.data && !settings.data.canEdit
          ? " Only the owner can change these; as a manager you can read them."
          : ""}
      </AdminHeader>
      {settings.isError ? (
        <Notice>{loadError(settings.error, "the settings", company)}</Notice>
      ) : !settings.data ? (
        <RowsSkeleton rows={6} />
      ) : (
        // Starts again from what is stored whenever that changes (after a save),
        // but not on a plain refetch, which would wipe what is being typed.
        <SettingsForm
          key={JSON.stringify(settings.data)}
          company={company}
          loaded={settings.data}
        />
      )}
    </>
  );
}

function SettingsForm({ company, loaded }: { company: AdminCompany; loaded: Loaded }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const locked = !loaded.canEdit;
  const stored = {
    name: loaded.name,
    tag: loaded.tag ?? "",
    logoUrl: loaded.logoUrl ?? "",
    about: loaded.about,
    discordGuildId: loaded.discordGuildId ?? "",
    deliveryChannelId: loaded.discord.deliveryChannelId ?? "",
    rankUpChannelId: loaded.discord.rankUpChannelId ?? "",
    eventChannelId: loaded.discord.eventChannelId ?? "",
    monthlyChannelId: loaded.discord.monthlyChannelId ?? "",
  };
  const [form, setForm] = useState(stored);
  const [checked, setChecked] = useState(false);
  const [aboutView, setAboutView] = useState<"write" | "preview">("write");
  const [logoBroken, setLogoBroken] = useState(false);
  const set = (key: keyof typeof stored) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  const dirty = (Object.keys(stored) as (keyof typeof stored)[]).some((k) => form[k] !== stored[k]);

  const clientId = useQuery({
    queryKey: ["discord-client-id"],
    queryFn: () => getDiscordClientId(),
    staleTime: Number.POSITIVE_INFINITY,
  });

  const save = useMutation(
    trpc.admin.settings.update.mutationOptions({
      onSuccess: async () => {
        toast.success("Settings saved.");
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: trpc.admin.settings.pathKey() }),
          // The name, tag and logo show on other screens too.
          queryClient.invalidateQueries({ queryKey: trpc.company.pathKey() }),
          queryClient.invalidateQueries({ queryKey: trpc.driver.pathKey() }),
        ]);
      },
    }),
  );

  const idError = (value: string) =>
    value.trim() === "" || isDiscordId(value.trim())
      ? null
      : "An ID is a long number, like 1234567890123456789.";
  const logo = form.logoUrl.trim();
  const errors = {
    name:
      form.name.trim().length < 2
        ? "Enter the company's name."
        : form.name.trim().length > 60
          ? "Keep the name under 60 characters."
          : null,
    tag: form.tag.trim().length > 8 ? "A tag has 8 characters at most." : null,
    logoUrl:
      logo === "" || (/^https:\/\/\S+\.\S+/.test(logo) && logo.length <= 500)
        ? null
        : "Use a link that starts with https://.",
    about: form.about.length > ABOUT_MAX ? `Keep it under ${ABOUT_MAX} characters.` : null,
    discordGuildId: idError(form.discordGuildId),
    deliveryChannelId: idError(form.deliveryChannelId),
    rankUpChannelId: idError(form.rankUpChannelId),
    eventChannelId: idError(form.eventChannelId),
    monthlyChannelId: idError(form.monthlyChannelId),
  };
  const shown = (key: keyof typeof errors) => (checked ? errors[key] : null);

  function submit(e: FormEvent) {
    e.preventDefault();
    setChecked(true);
    if (Object.values(errors).some(Boolean)) {
      toast.error("Some fields aren't right. They're marked below.");
      return;
    }
    const idOrNull = (value: string) => value.trim() || null;
    save.mutate({
      companyId: company.id,
      name: form.name.trim(),
      tag: form.tag.trim() || null,
      logoUrl: logo || null,
      about: form.about,
      discordGuildId: idOrNull(form.discordGuildId),
      discord: {
        deliveryChannelId: idOrNull(form.deliveryChannelId),
        rankUpChannelId: idOrNull(form.rankUpChannelId),
        eventChannelId: idOrNull(form.eventChannelId),
        monthlyChannelId: idOrNull(form.monthlyChannelId),
      },
    });
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-6">
      <Section title="Company">
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem]">
          <Field
            id="company-name"
            label="Name"
            value={form.name}
            onChange={set("name")}
            placeholder="Nordic Haulage"
            maxLength={60}
            disabled={locked}
            error={shown("name")}
          />
          <Field
            id="company-tag"
            label="Tag (optional)"
            value={form.tag}
            onChange={set("tag")}
            placeholder="NH"
            maxLength={8}
            disabled={locked}
            error={shown("tag")}
          />
        </div>
        <div className="flex items-start gap-4">
          <Field
            id="company-logo"
            label="Logo link (optional)"
            className="flex-1"
            type="url"
            value={form.logoUrl}
            onChange={(e) => {
              setLogoBroken(false);
              set("logoUrl")(e);
            }}
            placeholder="https://example.com/logo.png"
            maxLength={500}
            disabled={locked}
            hint="A square image works best. It has to be an https link."
            error={shown("logoUrl") ?? (logoBroken ? "That link doesn't load as an image." : null)}
          />
          {logo && !errors.logoUrl && !logoBroken && (
            <img
              src={logo}
              alt="Logo preview"
              referrerPolicy="no-referrer"
              onError={() => setLogoBroken(true)}
              className="mt-[26px] size-11 shrink-0 rounded-lg border bg-secondary object-cover"
            />
          )}
        </div>
        <p className="text-[13px] text-muted-foreground">
          Your page is at <span className="font-medium text-foreground">/vtc/{loaded.slug}</span>.
          The address stays the same when the name changes.
        </p>
      </Section>

      <Section title="About">
        <Field
          id="company-about"
          label="About the company"
          hint={
            <>
              Shown on your public page. Markdown works: **bold**, lists, links.{" "}
              <span className="tabular">
                {form.about.length} of {ABOUT_MAX} characters.
              </span>
            </>
          }
          error={shown("about")}
        >
          <Segmented
            label="About text view"
            options={[
              { value: "write", label: "Write" },
              { value: "preview", label: "Preview" },
            ]}
            value={aboutView}
            onChange={setAboutView}
          />
          {aboutView === "write" ? (
            <Textarea
              id="company-about"
              value={form.about}
              onChange={set("about")}
              disabled={locked}
              rows={8}
              placeholder={
                "We haul across Scandinavia, mostly at night.\n\n- Convoy every Friday\n- Real-speed driving"
              }
              aria-invalid={shown("about") ? true : undefined}
              className="min-h-44 bg-card px-3 py-2.5 text-[15px] leading-relaxed md:text-sm dark:bg-input/30"
            />
          ) : (
            <div className="min-h-44 rounded-lg border px-4 py-3">
              {form.about.trim() ? (
                <Markdown>{form.about}</Markdown>
              ) : (
                <p className="text-[15px] text-muted-foreground">Nothing written yet.</p>
              )}
            </div>
          )}
        </Field>
      </Section>

      <Section title="Discord">
        <div className="space-y-4">
          <ol className="max-w-2xl list-decimal space-y-1.5 pl-5 text-[14px] leading-relaxed text-muted-foreground">
            <li>Add the Tacho bot to your server. You need Manage Server there.</li>
            <li>In Discord, turn on Developer Mode: User Settings, Advanced, Developer Mode.</li>
            <li>
              Right-click your server's name and choose Copy Server ID. Right-click a channel and
              choose Copy Channel ID.
            </li>
            <li>Paste the IDs below. Leave a channel empty to switch those messages off.</li>
          </ol>
          {clientId.data ? (
            <a
              href={botInviteUrl(clientId.data, form.discordGuildId.trim())}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(buttonVariants({ variant: "outline" }))}
            >
              Add the bot to your server <ExternalLink aria-hidden="true" />
            </a>
          ) : clientId.isError ? (
            <p className="text-[13px] text-destructive">Couldn't build the bot link. Reload.</p>
          ) : null}
        </div>
        <Field
          id="discord-server"
          label="Server ID"
          className="tabular max-w-sm"
          value={form.discordGuildId}
          onChange={set("discordGuildId")}
          placeholder="1234567890123456789"
          inputMode="numeric"
          disabled={locked}
          error={shown("discordGuildId")}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          {CHANNELS.map((c) => (
            <Field
              key={c.key}
              id={`discord-${c.key}`}
              label={c.label}
              className="tabular"
              value={form[c.key]}
              onChange={set(c.key)}
              placeholder="1234567890123456789"
              inputMode="numeric"
              disabled={locked}
              hint={c.hint}
              error={shown(c.key)}
            />
          ))}
        </div>
        <p className="text-[13px] leading-relaxed text-muted-foreground">
          Rank roles are set per rank, on the Ranks tab. In your server's role list, keep the Tacho
          role above the rank roles, or Discord won't let the bot hand them out.
        </p>
      </Section>

      {!locked && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button type="submit" disabled={save.isPending || !dirty}>
            {save.isPending ? "Saving…" : "Save settings"}
          </Button>
          {save.isError ? (
            <p role="alert" className="text-[14px] text-destructive">
              {saveError(save.error)}
            </p>
          ) : (
            !dirty && <p className="text-[14px] text-muted-foreground">No changes to save.</p>
          )}
        </div>
      )}
    </form>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border bg-card">
      <h3 className="border-b px-5 py-3.5 text-[17px] font-bold tracking-tight">{title}</h3>
      <div className="space-y-5 p-5">{children}</div>
    </section>
  );
}
