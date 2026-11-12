import {
  type MotionValue,
  motion,
  useMotionValueEvent,
  useScroll,
  useTransform,
} from "motion/react";
import { useRef, useState } from "react";

import { GameBadge } from "./bits";
import { ROUTES } from "./sample-data";
import { useReducedMotionSafe } from "./use-reduced-motion";

const STEP_DEG = 20; // angle between rows on the drum
const RADIUS = "min(34vh, 300px)";

/**
 * A pinned section: deliveries roll past on a 3D drum as you scroll, and the
 * one facing you lights up. With reduced motion it's a plain list.
 */
export function RouteDrum() {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotionSafe();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const position = useTransform(scrollYProgress, [0.05, 0.95], [0, ROUTES.length - 1], {
    clamp: true,
  });
  const [active, setActive] = useState(0);
  useMotionValueEvent(position, "change", (v) => setActive(Math.round(v)));

  const heading = (
    <div className="mx-auto max-w-2xl px-5 text-center">
      <h2 className="text-[clamp(2rem,4.5vw,3.5rem)] leading-[1] font-extrabold">
        Every delivery, logged on its own.
      </h2>
      <p className="mt-4 text-[17px] leading-relaxed text-muted-foreground">
        Delivered or cancelled, the tracker sends the job the moment the game reports it. You keep
        driving; it keeps count.
      </p>
    </div>
  );

  if (reduce) {
    return (
      <section ref={ref} className="py-24">
        {heading}
        <ul className="mx-auto mt-10 max-w-xl divide-y divide-border px-5">
          {ROUTES.map((r) => (
            <li key={r.from + r.to} className="flex items-center justify-between gap-3 py-3">
              <span className="font-display text-xl font-bold">
                {r.from} → {r.to}
              </span>
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <GameBadge game={r.game} /> {r.cargo}
              </span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const current = ROUTES[active]!;
  return (
    <section
      ref={ref}
      aria-label="Deliveries the tracker logs"
      style={{ height: `${ROUTES.length * 32 + 100}vh` }}
    >
      <div className="sticky top-0 flex h-svh flex-col justify-center overflow-hidden pt-16">
        {heading}

        <div
          className="relative mx-auto mt-6 h-[min(46vh,380px)] w-full max-w-6xl overflow-hidden"
          style={{ maskImage: "linear-gradient(transparent, #000 22%, #000 78%, transparent)" }}
        >
          {/* The row facing the viewer sits between these two rules. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-5 top-1/2 h-[clamp(3.4rem,8vw,6rem)] -translate-y-1/2 border-y border-border"
            style={{
              background:
                "radial-gradient(60% 120% at 50% 50%, rgba(245,165,36,0.16), transparent 70%)",
            }}
          />
          <div
            className="absolute inset-0"
            style={{ perspective: 1100, perspectiveOrigin: "50% 50%" }}
          >
            <div className="absolute inset-0" style={{ transformStyle: "preserve-3d" }}>
              {ROUTES.map((r, i) => (
                <DrumRow
                  key={r.from + r.to}
                  index={i}
                  position={position}
                  label={`${r.from} → ${r.to}`}
                  active={i === active}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="mx-auto mt-4 flex w-full max-w-6xl items-center justify-between px-5 text-[15px]">
          <span className="tabular text-muted-foreground">
            <span className="font-semibold text-signal-ink">{active + 1}</span> of {ROUTES.length}
          </span>
          <span className="flex items-center gap-2 font-medium">
            <GameBadge game={current.game} /> {current.cargo}
          </span>
        </div>
      </div>
    </section>
  );
}

function DrumRow({
  index,
  position,
  label,
  active,
}: {
  index: number;
  position: MotionValue<number>;
  label: string;
  active: boolean;
}) {
  const angle = useTransform(position, (p) => (index - p) * STEP_DEG);
  // Pull the cylinder back by its radius so the front row sits at its natural size.
  const transform = useTransform(
    angle,
    (a) => `translateZ(calc(${RADIUS} * -1)) rotateX(${-a}deg) translateZ(${RADIUS})`,
  );
  const opacity = useTransform(angle, (a) => Math.max(0, 1 - Math.abs(a) / 85));
  const blur = useTransform(angle, (a) => `blur(${Math.min(4, Math.abs(a) / 18)}px)`);

  return (
    <motion.div
      aria-hidden={!active}
      className={`absolute inset-x-0 top-1/2 -mt-[0.6em] text-center font-display text-[clamp(2rem,7vw,5.5rem)] leading-[1.2] font-extrabold whitespace-nowrap transition-colors duration-200 [backface-visibility:hidden] ${
        active ? "text-signal-ink" : "text-[var(--drum-idle)]"
      }`}
      style={{ transform, opacity, filter: blur }}
    >
      {label}
    </motion.div>
  );
}
