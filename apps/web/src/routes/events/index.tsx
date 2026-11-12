import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Skeleton } from "@te-rebrand/ui/components/skeleton";

import { type ConvoyListItem, ConvoyRow } from "@/components/convoy-row";
import { useTRPC } from "@/utils/trpc";

// Every upcoming convoy hosted by a VTC on Tacho. Sign-ups are on TruckersMP.
export const Route = createFileRoute("/events/")({
  component: ConvoysPage,
});

const dayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });

function dayLabel(d: Date, now = new Date()) {
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86_400_000);
  return diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : dayFmt.format(d);
}

/** Groups convoys under one heading per day, in the viewer's time zone. */
function byDay(events: ConvoyListItem[]) {
  const groups: { label: string; events: ConvoyListItem[] }[] = [];
  for (const e of events) {
    const label = dayLabel(new Date(e.startAt));
    const last = groups.at(-1);
    if (last?.label === label) last.events.push(e);
    else groups.push({ label, events: [e] });
  }
  return groups;
}

function ConvoysPage() {
  const trpc = useTRPC();
  const list = useQuery(trpc.events.list.queryOptions());

  return (
    <main className="mx-auto w-full max-w-3xl px-5 pt-28 pb-16 md:px-8">
      <h1 className="text-[clamp(2rem,4vw,2.75rem)] leading-none font-extrabold">
        Convoys on Tacho
      </h1>
      <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
        Upcoming convoys hosted by VTCs that log their jobs with Tacho. They're run on TruckersMP;
        open one to see the route and sign up there.
      </p>

      <div className="mt-8 space-y-6">
        {list.isPending ? (
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-2xl" />
            ))}
          </div>
        ) : list.isError || list.data.unavailable ? (
          <Notice>Couldn't reach TruckersMP right now. Try again in a minute.</Notice>
        ) : list.data.events.length === 0 ? (
          <Notice>No VTC on Tacho has a convoy planned yet.</Notice>
        ) : (
          byDay(list.data.events).map((group) => (
            <section key={group.label}>
              <h2 className="mb-2 text-[15px] font-bold text-muted-foreground">{group.label}</h2>
              <ul className="divide-y overflow-hidden rounded-2xl border bg-card">
                {group.events.map((e) => (
                  <li key={e.id}>
                    <ConvoyRow convoy={e} showHost />
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </main>
  );
}

function Notice({ children }: { children: string }) {
  return (
    <p className="rounded-2xl border bg-card px-5 py-8 text-[15px] text-muted-foreground">
      {children}
    </p>
  );
}
