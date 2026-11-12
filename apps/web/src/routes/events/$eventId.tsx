import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Button } from "@te-rebrand/ui/components/button";
import { Skeleton } from "@te-rebrand/ui/components/skeleton";
import { ArrowLeft, ArrowUpRight, Clock, Headphones, MapPin, Server, Users } from "lucide-react";
import type { ReactNode } from "react";

import { GameBadge } from "@/components/landing/bits";
import { Markdown } from "@/components/markdown";
import { useTRPC } from "@/utils/trpc";

// A TruckersMP convoy. Sign-ups happen on TruckersMP; we only show the event.
export const Route = createFileRoute("/events/$eventId")({
  component: EventPage,
});

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  weekday: "short",
  day: "numeric",
  month: "long",
});
const timeFmt = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  timeZoneName: "short",
});

function EventPage() {
  const { eventId } = Route.useParams();
  const id = Number.parseInt(eventId, 10);
  const trpc = useTRPC();
  const event = useQuery({ ...trpc.events.byId.queryOptions({ id }), enabled: id > 0, retry: 1 });

  if (!(id > 0) || event.isError) {
    return (
      <Page>
        <BackLink />
        <h1 className="mt-6 text-3xl font-extrabold">Convoy not found</h1>
        <p className="mt-2 text-muted-foreground">
          {event.error?.message ?? "That doesn't look like a TruckersMP event ID."}
        </p>
      </Page>
    );
  }
  if (!event.data) {
    return (
      <Page>
        <Skeleton className="aspect-[3/1] w-full rounded-[24px]" />
        <Skeleton className="mt-6 h-10 w-2/3" />
        <Skeleton className="mt-4 h-40 w-full rounded-2xl" />
      </Page>
    );
  }

  const e = event.data;
  const startAt = new Date(e.startAt);
  const meetupAt = new Date(e.meetupAt);

  return (
    <Page>
      <BackLink />
      {e.banner && (
        <img
          src={e.banner}
          alt=""
          referrerPolicy="no-referrer"
          className="mt-5 aspect-[3/1] w-full rounded-[24px] border object-cover"
        />
      )}

      <header className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
            <GameBadge game={e.game === "ats" ? "ATS" : "ETS2"} />
            {e.type && <span>{e.type}</span>}
            {e.language && <span>· {e.language}</span>}
            {e.vtc && <span>· by {e.vtc.name}</span>}
          </div>
          <h1 className="mt-2 text-[clamp(1.9rem,4vw,2.75rem)] leading-[1.05] font-extrabold">
            {e.name}
          </h1>
        </div>
        <a href={e.url} target="_blank" rel="noopener noreferrer">
          <Button size="lg">
            Sign up on TruckersMP <ArrowUpRight className="size-4" />
          </Button>
        </a>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-6">
          {e.description.trim() && (
            <Section title="About this convoy">
              <Markdown>{e.description}</Markdown>
            </Section>
          )}
          {e.rules.trim() && (
            <Section title="Rules">
              <Markdown>{e.rules}</Markdown>
            </Section>
          )}
          {e.map && (
            <Section title="Route map">
              <img
                src={e.map}
                alt={`Route map from ${e.from.city ?? "start"} to ${e.to.city ?? "finish"}`}
                referrerPolicy="no-referrer"
                loading="lazy"
                className="h-auto w-full rounded-xl border"
              />
            </Section>
          )}
        </div>

        {/* Facts first on phones; beside the description from lg up. */}
        <aside className="order-first space-y-6 lg:sticky lg:top-28 lg:order-none lg:self-start">
          <section className="overflow-hidden rounded-2xl border bg-card">
            <dl className="divide-y text-[14px]">
              <Fact icon={<Clock className="size-4" />} label="Departure">
                {dateFmt.format(startAt)}
                <br />
                <span className="tabular font-semibold">{timeFmt.format(startAt)}</span>
                <span className="text-muted-foreground"> · meet at {timeFmt.format(meetupAt)}</span>
              </Fact>
              <Fact icon={<MapPin className="size-4" />} label="Route">
                <span className="font-semibold">
                  {e.from.city ?? "?"} <span className="text-signal-ink">→</span> {e.to.city ?? "?"}
                </span>
                {(e.from.location || e.to.location) && (
                  <span className="block text-muted-foreground">
                    {[e.from.location, e.to.location].filter(Boolean).join(" → ")}
                  </span>
                )}
              </Fact>
              {e.server && (
                <Fact icon={<Server className="size-4" />} label="Server">
                  {e.server}
                </Fact>
              )}
              <Fact icon={<Users className="size-4" />} label="Attending on TruckersMP">
                <span className="tabular">
                  <span className="font-semibold">{e.attending.confirmed}</span> going
                  {e.attending.unsure > 0 && `, ${e.attending.unsure} maybe`}
                  {e.attending.vtcs > 0 && ` · ${e.attending.vtcs} VTCs`}
                </span>
              </Fact>
              {e.voiceLink && (
                <Fact icon={<Headphones className="size-4" />} label="Voice">
                  <a
                    href={e.voiceLink}
                    target="_blank"
                    rel="noopener noreferrer nofollow"
                    className="font-medium text-signal-ink underline underline-offset-2"
                  >
                    Join the voice channel
                  </a>
                </Fact>
              )}
            </dl>
          </section>
          <p className="text-[13px] text-muted-foreground">
            Event details come from TruckersMP and may change. Times are shown in your time zone.
          </p>
        </aside>
      </div>
    </Page>
  );
}

function Page({ children }: { children: ReactNode }) {
  return <main className="mx-auto w-full max-w-6xl px-5 pt-28 pb-16 md:px-8">{children}</main>;
}

function BackLink() {
  return (
    <Link
      to="/events"
      className="inline-flex items-center gap-1.5 rounded-md text-[14px] text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" /> All convoys
    </Link>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-2xl border bg-card p-5 md:p-7">
      <h2 className="mb-4 text-xl font-bold">{title}</h2>
      {children}
    </section>
  );
}

function Fact({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 px-5 py-4">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <dt className="text-[12px] text-muted-foreground">{label}</dt>
        <dd className="mt-0.5">{children}</dd>
      </div>
    </div>
  );
}
