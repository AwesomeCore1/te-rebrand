import { Check, Radio } from "lucide-react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { type ReactNode, useRef, useState } from "react";

import { DiscordIcon, GameBadge, TachoMark } from "./bits";
import { LIVE_JOB as J } from "./sample-data";
import { useReducedMotionSafe } from "./use-reduced-motion";

const STEPS: { title: string; body: string; visual: () => ReactNode }[] = [
  {
    title: "Log in with Discord",
    body: "Then link Steam on Steam's own sign-in page. That's how we find your TruckersMP profile and check your VTC. We never see your Steam password.",
    visual: AccountVisual,
  },
  {
    title: "Install the tracker",
    body: "Windows 10 and 11. It sits in the tray, finds ETS2 and ATS, and adds the telemetry plugin to each game for you.",
    visual: TrayVisual,
  },
  {
    title: "Drive",
    body: "Take any job, in singleplayer or on TruckersMP. Distance comes from the truck's odometer, in kilometres, shown in miles if you prefer.",
    visual: DriveVisual,
  },
  {
    title: "It counts",
    body: "The delivery lands on your profile and your company's leaderboard. Pass a rank's distance and the Discord bot gives you the role.",
    visual: CountsVisual,
  },
];

export function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotionSafe();
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  useMotionValueEvent(scrollYProgress, "change", (p) =>
    setActive(Math.min(STEPS.length - 1, Math.max(0, Math.floor(p * STEPS.length)))),
  );

  const heading = (
    <h2 className="text-[clamp(2rem,4.5vw,3.5rem)] leading-[1] font-extrabold">
      From install to leaderboard in four steps.
    </h2>
  );
  const Visual = STEPS[active]!.visual;

  return (
    <section id="how-it-works" className="scroll-mt-20">
      {/* Phones: a plain stack, every step with its picture. */}
      <div className="px-5 py-20 md:hidden">
        {heading}
        <ol className="mt-10 space-y-12">
          {STEPS.map((s, i) => (
            <li key={s.title}>
              <StepText index={i} title={s.title} body={s.body} active />
              <div className="mt-5">
                <Frame>{s.visual()}</Frame>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Tablet and up: the list stays put and scrolling moves through the steps. */}
      <div ref={ref} className="hidden md:block" style={{ height: `${STEPS.length * 80 + 20}vh` }}>
        <div className="sticky top-0 mx-auto grid h-svh max-w-6xl grid-cols-[minmax(0,5fr)_minmax(0,7fr)] items-center gap-12 px-8 lg:gap-16">
          <div>
            {heading}
            <ol className="mt-10 space-y-2">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <StepText index={i} title={s.title} body={s.body} active={i === active} />
                </li>
              ))}
            </ol>
          </div>
          <div className="relative">
            <Frame>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={active}
                  initial={reduce ? false : { opacity: 0, y: 14, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={reduce ? undefined : { opacity: 0, y: -10, scale: 0.98 }}
                  transition={{ duration: 0.25, ease: "easeOut" }}
                >
                  <Visual />
                </motion.div>
              </AnimatePresence>
            </Frame>
            <div className="tabular absolute -bottom-12 right-2 rounded-full bg-foreground px-3 py-1 text-[13px] font-medium text-background">
              Step {active + 1} of {STEPS.length}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function StepText({
  index,
  title,
  body,
  active,
}: {
  index: number;
  title: string;
  body: string;
  active: boolean;
}) {
  return (
    <div
      className={`border-l-2 py-2 pl-5 transition-colors duration-200 ${active ? "border-[#f5a524]" : "border-border"}`}
    >
      <h3
        className={`text-lg font-bold tracking-tight ${active ? "text-foreground" : "text-muted-foreground"}`}
      >
        <span className="tabular mr-2 text-signal-ink">{index + 1}</span>
        {title}
      </h3>
      <div
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${
          active ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
        }`}
      >
        <p className="overflow-hidden pt-1 text-[15px] leading-relaxed text-muted-foreground">
          {body}
        </p>
      </div>
    </div>
  );
}

/** The warm lit ground every step's picture sits on. */
function Frame({ children }: { children: ReactNode }) {
  return (
    <div
      className="flex min-h-[340px] items-center justify-center rounded-[22px] border border-border p-6 md:min-h-[460px] md:p-10"
      style={{
        background:
          "radial-gradient(80% 70% at 50% 100%, var(--panel-glow), transparent 70%), linear-gradient(180deg, var(--panel-from), var(--panel-to))",
      }}
    >
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-border bg-card shadow-[var(--float-shadow)] ${className ?? ""}`}
    >
      {children}
    </div>
  );
}

function Row({
  icon,
  title,
  sub,
  ok = true,
}: {
  icon: ReactNode;
  title: string;
  sub: string;
  ok?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-secondary">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold">{title}</div>
        <div className="truncate text-[13px] text-muted-foreground">{sub}</div>
      </div>
      {ok && (
        <span className="flex size-6 items-center justify-center rounded-full bg-success-bg text-success">
          <Check className="size-3.5" strokeWidth={3} />
        </span>
      )}
    </div>
  );
}

function AccountVisual() {
  return (
    <Panel className="divide-y divide-border">
      <Row icon={<DiscordIcon className="text-discord" />} title="Discord" sub="Logged in as Dev" />
      <Row
        icon={<span className="text-[11px] font-bold">STM</span>}
        title="Steam"
        sub="SteamID 7656119…4817"
      />
      <Row
        icon={<span className="text-[11px] font-bold text-signal-ink">NH</span>}
        title="Nordic Haulage"
        sub="Your TruckersMP VTC · 42 members"
      />
    </Panel>
  );
}

function TrayVisual() {
  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="flex items-center gap-2 text-[15px] font-semibold">
          <TachoMark className="size-5" /> Tacho
        </span>
        <span className="flex items-center gap-1.5 text-[13px] text-success">
          <span className="size-1.5 rounded-full bg-success" /> Connected
        </span>
      </div>
      <div className="divide-y divide-border">
        <Row
          icon={<GameBadge game="ETS2" />}
          title="Euro Truck Simulator 2"
          sub="Telemetry plugin installed"
        />
        <Row
          icon={<GameBadge game="ATS" />}
          title="American Truck Simulator"
          sub="Telemetry plugin installed"
        />
      </div>
      <div className="bg-secondary/60 px-4 py-3 text-[13px] text-muted-foreground">
        Waiting for a game to start. Close this window; Tacho stays in the tray.
      </div>
    </Panel>
  );
}

function DriveVisual() {
  const reduce = useReducedMotionSafe();
  const pct = (J.drivenKm / J.plannedKm) * 100;
  return (
    <Panel className="p-5">
      <div className="flex items-center justify-between">
        <GameBadge game="ETS2" />
        <span className="flex items-center gap-1 text-[12px] font-semibold text-success">
          <Radio className="size-3.5" /> Tracking
        </span>
      </div>
      <div className="mt-3 font-display text-2xl font-bold">
        {J.from} <span className="text-signal-ink">→</span> {J.to}
      </div>
      <div className="text-[13px] text-muted-foreground">
        {J.cargo}, {J.massT} t · {J.truck}
      </div>
      <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary">
        <motion.div
          className="h-full rounded-full bg-[#f5a524]"
          initial={{ width: reduce ? `${pct}%` : `${pct - 18}%` }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 1.6, ease: "easeOut" }}
        />
      </div>
      <div className="tabular mt-2 flex justify-between text-[13px]">
        <span className="font-medium">742 km driven · 461 mi</span>
        <span className="text-muted-foreground">454 km left</span>
      </div>
      <dl className="tabular mt-4 grid grid-cols-3 border-t border-border pt-3 text-[13px]">
        <div>
          <dt className="text-muted-foreground">Speed</dt>
          <dd className="font-semibold">84 km/h</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Damage</dt>
          <dd className="font-semibold">1.2 %</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Income</dt>
          <dd className="font-semibold">{J.income}</dd>
        </div>
      </dl>
    </Panel>
  );
}

function CountsVisual() {
  return (
    <div className="space-y-3">
      <Panel className="flex items-center gap-3 p-4">
        <span className="flex size-9 items-center justify-center rounded-full bg-success-bg text-success">
          <Check className="size-4" strokeWidth={3} />
        </span>
        <div className="flex-1">
          <div className="text-[15px] font-semibold">Hamburg → Lyon delivered</div>
          <div className="tabular text-[13px] text-muted-foreground">
            1 196 km · added to Nordic Haulage
          </div>
        </div>
      </Panel>
      <Panel className="p-4">
        <div className="text-[13px] text-muted-foreground">Rank up</div>
        <div className="mt-1 flex items-center justify-between">
          <span className="font-display text-xl font-bold">Senior Driver</span>
          <span className="tabular text-[13px] text-muted-foreground">from 15 000 km</span>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-[var(--discord-chip-bg)] px-3 py-2 text-[13px] text-[var(--discord-chip-fg)]">
          <DiscordIcon className="size-4" /> Role given in the Nordic Haulage Discord
        </div>
      </Panel>
    </div>
  );
}
