import { Users } from "lucide-react";
import { motion, useInView } from "motion/react";
import { type ReactNode, useRef } from "react";

import { GameBadge } from "./bits";
import { EVENTS, GOAL, LEADERBOARD, km } from "./sample-data";
import { useReducedMotionSafe } from "./use-reduced-motion";

export function Features() {
  return (
    <section id="for-vtcs" className="mx-auto max-w-6xl scroll-mt-20 px-5 py-24 md:px-8 md:py-32">
      <h2 className="max-w-2xl text-[clamp(2rem,4.5vw,3.5rem)] leading-[1] font-extrabold">
        Built for how VTCs actually run.
      </h2>
      <div className="mt-12 space-y-6 md:mt-16">
        <FeatureRow
          title="Ranked by real kilometres"
          body="Every delivery counts towards the company leaderboard and each driver's rank. Promotions turn into Discord roles without anyone lifting a finger."
          visual={<LeaderboardMock />}
        />
        <FeatureRow
          flip
          title="Your convoys, where drivers look"
          body="Plan convoys on TruckersMP like you already do. Tacho puts your VTC's upcoming events on every driver's dashboard: the route, the server, the meeting time and who's going."
          visual={<EventsMock />}
        />
        <FeatureRow
          title="A live map for convoy night"
          body="While someone drives, the tracker sends their position every 5 seconds. Drivers can hide from the public map; your company always sees its own members."
          visual={<MapMock />}
          dark
        />
        <FeatureRow
          flip
          title="Goals the whole company drives for"
          body="Set a target in kilometres, jobs or income for the month. Every delivery fills it, and the bot posts the progress to your Discord."
          visual={<GoalMock />}
        />
      </div>
    </section>
  );
}

function FeatureRow({
  title,
  body,
  visual,
  flip,
  dark,
}: {
  title: string;
  body: string;
  visual: ReactNode;
  flip?: boolean;
  dark?: boolean;
}) {
  const reduce = useReducedMotionSafe();
  return (
    <motion.article
      initial={reduce ? false : { opacity: 0, y: 32 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-15% 0px" }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="grid overflow-hidden rounded-[24px] border border-border bg-card md:grid-cols-2"
    >
      <div
        className={`relative flex min-h-[320px] items-center justify-center p-5 md:min-h-[440px] md:p-10 ${flip ? "md:order-2" : ""}`}
        style={{
          background: dark
            ? "radial-gradient(90% 60% at 50% 110%, rgba(245,165,36,0.55), transparent 70%), linear-gradient(180deg, #120c07, #2a1709)"
            : "radial-gradient(80% 70% at 50% 100%, var(--panel-glow), transparent 70%), linear-gradient(180deg, var(--panel-from), var(--panel-to))",
        }}
      >
        <div className="w-full max-w-[460px]">{visual}</div>
      </div>
      <div className="flex flex-col justify-center p-7 md:p-12">
        <h3 className="text-[clamp(1.6rem,3vw,2.25rem)] leading-[1.05] font-extrabold">{title}</h3>
        <p className="mt-4 max-w-md text-[17px] leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </motion.article>
  );
}

function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-border bg-card shadow-[var(--float-shadow)] ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

function LeaderboardMock() {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <span className="text-[14px] font-semibold">Leaderboard · November</span>
        <span className="flex gap-1 text-[11px]">
          <span className="rounded-full bg-[#f5a524] px-2 py-0.5 font-semibold text-[#1a1204]">
            Month
          </span>
          <span className="hidden rounded-full bg-secondary px-2 py-0.5 sm:inline">Week</span>
          <span className="hidden rounded-full bg-secondary px-2 py-0.5 sm:inline">All time</span>
        </span>
      </div>
      <ol className="tabular divide-y divide-border text-[13px]">
        {LEADERBOARD.map((d, i) => (
          <li
            key={d.name}
            className={`flex items-center gap-3 px-4 py-2.5 ${d.you ? "bg-[var(--row-highlight)]" : ""}`}
          >
            <span className="w-4 text-muted-foreground">{i + 1}</span>
            <span
              className="size-6 shrink-0 rounded-full"
              style={{ background: d.color }}
              aria-hidden="true"
            />
            <span className="min-w-0 flex-1 truncate font-semibold">{d.name}</span>
            <span className="hidden rounded-full bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground sm:inline">
              {d.rank}
            </span>
            <span className="w-20 text-right font-semibold">{km(d.km)}</span>
            <span className="hidden w-8 text-right text-muted-foreground sm:inline">{d.jobs}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

function EventsMock() {
  return (
    <Card className="divide-y divide-border">
      {EVENTS.map((e) => (
        <div key={e.title} className="flex items-center gap-3 px-4 py-3">
          <div className="tabular flex w-11 shrink-0 flex-col items-center rounded-xl bg-secondary py-1.5">
            <span className="text-[17px] leading-none font-bold">{e.day}</span>
            <span className="text-[10px] font-semibold text-signal-ink">{e.month}</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-[14px] font-semibold">
              <span className="truncate">{e.title}</span>
              {"public" in e && (
                <span className="rounded-full bg-secondary px-1.5 text-[10px] font-medium">
                  Public
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <GameBadge game={e.game} className="h-4 px-1.5 text-[10px]" /> {e.route} · {e.meta}
            </div>
          </div>
          <span className="tabular hidden items-center gap-1 text-[12px] text-muted-foreground sm:flex">
            <Users className="size-3.5" /> {e.going}
          </span>
        </div>
      ))}
    </Card>
  );
}

// Not a real map projection: a schematic of the roads between the cities in
// the examples, so the preview reads as a map without shipping map tiles.
const CITIES = {
  Oslo: [262, 40],
  Malmö: [300, 104],
  Hamburg: [228, 150],
  Berlin: [300, 160],
  Calais: [110, 190],
  Praha: [314, 222],
  Lyon: [170, 298],
  Wien: [370, 262],
} as const;
const ROADS: [keyof typeof CITIES, keyof typeof CITIES][] = [
  ["Oslo", "Malmö"],
  ["Malmö", "Hamburg"],
  ["Hamburg", "Berlin"],
  ["Hamburg", "Calais"],
  ["Berlin", "Praha"],
  ["Praha", "Wien"],
  ["Calais", "Lyon"],
  ["Hamburg", "Lyon"],
];
const DRIVERS: { name: string; path: (keyof typeof CITIES)[]; dur: number }[] = [
  { name: "Dev", path: ["Hamburg", "Lyon"], dur: 14 },
  { name: "Kasper", path: ["Oslo", "Malmö"], dur: 9 },
  { name: "TruckerTom", path: ["Berlin", "Praha"], dur: 8 },
  { name: "Mehmet", path: ["Praha", "Wien"], dur: 11 },
];

function MapMock() {
  const ref = useRef<SVGSVGElement>(null);
  const inView = useInView(ref, { margin: "-10% 0px" });
  const reduce = useReducedMotionSafe();
  const p = (c: keyof typeof CITIES) => CITIES[c].join(" ");
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#1b140f]">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5 text-[13px] text-[#ece4d8]">
        <span className="font-semibold">On the road</span>
        <span className="tabular text-[#a89d90]">4 drivers · ETS2</span>
      </div>
      <svg
        ref={ref}
        viewBox="60 10 360 320"
        className="block h-auto w-full"
        role="img"
        aria-label="Example live map with four drivers on the road"
      >
        {ROADS.map(([a, b]) => (
          <path
            key={a + b}
            d={`M${p(a)} L${p(b)}`}
            stroke="#3a2d22"
            strokeWidth="3"
            strokeLinecap="round"
          />
        ))}
        {Object.entries(CITIES).map(([name, [x, y]]) => (
          <g key={name}>
            <circle cx={x} cy={y} r="3" fill="#6b5d50" />
            <text x={x + 7} y={y + 4} fontSize="11" fill="#a89d90">
              {name}
            </text>
          </g>
        ))}
        {DRIVERS.map((d) => {
          const [a, b] = d.path;
          return (
            <g key={d.name}>
              <circle r="6" fill="#f5a524" stroke="#1b140f" strokeWidth="2">
                {inView && !reduce && (
                  <animateMotion
                    dur={`${d.dur}s`}
                    repeatCount="indefinite"
                    path={`M${p(a!)} L${p(b!)}`}
                  />
                )}
              </circle>
              {(!inView || reduce) && (
                <circle
                  cx={(CITIES[a!][0] + CITIES[b!][0]) / 2}
                  cy={(CITIES[a!][1] + CITIES[b!][1]) / 2}
                  r="6"
                  fill="#f5a524"
                />
              )}
            </g>
          );
        })}
      </svg>
      <div className="border-t border-white/10 px-4 py-2.5 text-[12px] text-[#cfc5b8]">
        <span className="font-semibold text-[#ece4d8]">Dev</span> · Hamburg → Lyon · 84 km/h
      </div>
    </div>
  );
}

function GoalMock() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15% 0px" });
  const reduce = useReducedMotionSafe();
  const pct = (GOAL.done / GOAL.target) * 100;
  return (
    <Card className="p-5">
      <div ref={ref} className="text-[13px] text-muted-foreground">
        Company goal · November
      </div>
      <div className="mt-1 font-display text-2xl font-bold">{GOAL.title}</div>
      <div className="mt-4 h-3 overflow-hidden rounded-full bg-secondary">
        <motion.div
          className="h-full rounded-full bg-[#f5a524]"
          initial={{ width: reduce ? `${pct}%` : "0%" }}
          animate={{ width: inView || reduce ? `${pct}%` : "0%" }}
          transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>
      <div className="tabular mt-2 flex justify-between text-[13px]">
        <span className="font-semibold">
          {km(GOAL.done)} · {Math.round(pct)} %
        </span>
        <span className="text-muted-foreground">your share: {km(GOAL.yourShare)}</span>
      </div>
    </Card>
  );
}
