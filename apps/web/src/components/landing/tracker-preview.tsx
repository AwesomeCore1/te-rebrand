import { History, Radio, Settings, Truck } from "lucide-react";
import { animate, motion, useInView, useMotionValue, useTransform } from "motion/react";
import { useEffect, useRef } from "react";

import { GameBadge, TachoMark } from "./bits";
import { LIVE_JOB as J } from "./sample-data";
import { useReducedMotionSafe } from "./use-reduced-motion";

const KM_PER_MI = 1.609344;

/** The tracker's "Live job" screen as real HTML, with the odometer ticking. */
export function TrackerPreview() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-20% 0px" });
  const reduce = useReducedMotionSafe();
  const driven = useMotionValue(J.drivenKm - 60);

  useEffect(() => {
    if (reduce) {
      driven.set(J.drivenKm);
      return;
    }
    if (!inView) return;
    const controls = animate(driven, J.drivenKm, { duration: 2.4, ease: "easeOut" });
    return () => controls.stop();
  }, [inView, reduce, driven]);

  const kmText = useTransform(
    driven,
    (v) => `${Math.round(v)} km driven (${Math.round(v / KM_PER_MI)} mi)`,
  );
  const leftText = useTransform(
    driven,
    (v) => `1 196 km planned · ${Math.round(J.plannedKm - v)} km left`,
  );
  const width = useTransform(driven, (v) => `${(v / J.plannedKm) * 100}%`);

  return (
    <div
      ref={ref}
      className="flex min-h-[420px] overflow-hidden rounded-[18px] bg-[#16110d] text-[#ece4d8] md:min-h-[520px]"
    >
      <aside className="hidden w-52 shrink-0 flex-col border-r border-white/8 p-4 md:flex">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <TachoMark className="size-5" /> Tacho
        </div>
        <nav className="mt-6 space-y-1 text-[13px]" aria-hidden="true">
          <div className="flex items-center gap-2 rounded-lg bg-white/8 px-2.5 py-2 font-medium">
            <Truck className="size-4 text-[#f5a524]" /> Live job
          </div>
          <div className="flex items-center gap-2 px-2.5 py-2 text-[#a89d90]">
            <History className="size-4" /> History
          </div>
          <div className="flex items-center gap-2 px-2.5 py-2 text-[#a89d90]">
            <Settings className="size-4" /> Settings
          </div>
        </nav>
        <div className="mt-auto rounded-xl bg-white/5 p-3 text-[12px]">
          <div className="font-semibold">Dev</div>
          <div className="text-[#a89d90]">Nordic Haulage</div>
          <div className="mt-2 flex items-center gap-1.5 text-[#5fd394]">
            <span className="size-1.5 rounded-full bg-[#5fd394]" /> Connected · synced
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1 p-4 md:p-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-base font-semibold tracking-normal">Live job</h3>
          <div className="flex flex-wrap items-center gap-1.5">
            <GameBadge game="ETS2" className="bg-[#14243d] text-[#7fb0ff]" />
            <span className="inline-flex h-5 items-center rounded-full bg-white/8 px-2 text-[11px] text-[#cfc5b8]">
              TruckersMP · Simulation 1
            </span>
            <span className="inline-flex h-5 items-center gap-1 rounded-full bg-[#123222] px-2 text-[11px] font-semibold text-[#5fd394]">
              <Radio className="size-3" /> Tracking
            </span>
          </div>
        </div>

        <div className="mt-4 rounded-2xl border border-white/8 bg-white/[0.03] p-4 md:p-5">
          <div className="font-display text-2xl font-semibold md:text-3xl">
            {J.from} <span className="text-[#f5a524]">→</span> {J.to}
          </div>
          <div className="mt-1 text-[12px] text-[#a89d90] md:text-[13px]">
            {J.sourceCompany} → {J.destCompany} · {J.cargo}, {J.massT} t · {J.truck}
          </div>
          <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/10">
            <motion.div className="h-full rounded-full bg-[#f5a524]" style={{ width }} />
          </div>
          <div className="tabular mt-2 flex flex-wrap justify-between gap-x-4 text-[12px] text-[#cfc5b8]">
            <motion.span>{kmText}</motion.span>
            <motion.span className="text-[#a89d90]">{leftText}</motion.span>
          </div>
          <dl className="tabular mt-5 grid grid-cols-2 gap-y-4 border-t border-white/8 pt-4 md:grid-cols-4">
            {[
              ["Speed", `${J.speedKmh} km/h`],
              ["Damage", `${J.damagePct} %`],
              ["ETA (in-game)", J.eta],
              ["Expected income", J.income],
            ].map(([label, value]) => (
              <div key={label}>
                <dt className="text-[11px] text-[#a89d90]">{label}</dt>
                <dd className="mt-0.5 text-[15px] font-semibold md:text-base">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="tabular mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat label="Today" value="1 284 km" sub="5 jobs · 798 mi" />
          <Stat label="This month" value="18 940 km" sub="Rank: Senior Driver" />
          <Stat
            label="Company goal · November"
            value="64 %"
            sub="160 112 of 250 000 km"
            className="hidden md:block"
          />
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: string;
  sub: string;
  className?: string;
}) {
  return (
    <div className={`rounded-2xl border border-white/8 bg-white/[0.03] p-3.5 ${className ?? ""}`}>
      <div className="text-[11px] text-[#a89d90]">{label}</div>
      <div className="mt-1 text-lg font-semibold">{value}</div>
      <div className="text-[11px] text-[#a89d90]">{sub}</div>
    </div>
  );
}
