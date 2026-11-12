import { Link } from "@tanstack/react-router";
import { Button } from "@te-rebrand/ui/components/button";
import { ArrowDown } from "lucide-react";
import { motion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";

import { DiscordIcon } from "./bits";
import { TrackerPreview } from "./tracker-preview";
import { useReducedMotionSafe } from "./use-reduced-motion";

const enter = (delay: number) => ({
  initial: { opacity: 0, y: 18 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, delay, ease: [0.22, 1, 0.36, 1] as const },
});

export function Hero({ loggedIn }: { loggedIn: boolean }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotionSafe();
  // The product frame starts tipped back and stands up as you scroll to it.
  const { scrollYProgress } = useScroll({ target: frameRef, offset: ["start end", "start 0.2"] });
  const rotateX = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [26, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], reduce ? [1, 1] : [0.9, 1]);
  const y = useTransform(scrollYProgress, [0, 1], reduce ? [0, 0] : [40, 0]);

  return (
    <section className="relative isolate overflow-hidden pb-16 md:pb-28">
      <div
        aria-hidden="true"
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(85% 42% at 50% 60%, rgba(245,165,36,0.9) 0%, rgba(214,111,18,0.6) 32%, rgba(74,34,8,0) 70%), linear-gradient(180deg, #120c07 0%, #1f1209 34%, #3a1d0a 52%, #c96a12 68%, var(--hero-fade) 80%, var(--background) 90%)",
        }}
      />
      <div className="mx-auto flex max-w-5xl flex-col items-center px-5 pt-36 text-center md:pt-44">
        <motion.h1
          {...enter(0)}
          className="max-w-4xl text-[clamp(2.6rem,7vw,5.6rem)] leading-[0.95] font-extrabold text-[#fbf5ec] [font-stretch:92%]"
        >
          Track every kilometre. Run your whole VTC.
        </motion.h1>
        <motion.p
          {...enter(0.1)}
          className="mt-6 max-w-2xl text-[17px] leading-relaxed text-[#e9dccb] md:text-lg"
        >
          A small tray app logs every Euro Truck Simulator 2 and American Truck Simulator delivery
          on its own. Your company gets a leaderboard, ranks that become Discord roles, convoys and
          a live map.
        </motion.p>
        <motion.div {...enter(0.2)} className="mt-8 flex flex-wrap justify-center gap-3">
          {loggedIn ? (
            <Link to="/dashboard">
              <Button size="lg">Open your dashboard</Button>
            </Link>
          ) : (
            <Link to="/login" search={{}}>
              <Button size="lg">
                <DiscordIcon /> Log in with Discord
              </Button>
            </Link>
          )}
          <a href="#how-it-works">
            <Button
              size="lg"
              variant="outline"
              className="border-white/20 bg-white/5 text-[#fbf5ec] hover:bg-white/12 hover:text-white"
            >
              See how it works <ArrowDown className="size-4" />
            </Button>
          </a>
        </motion.div>
        <motion.p {...enter(0.3)} className="mt-5 text-[13px] text-[#d8c7b1]">
          Windows 10 and 11 · ETS2 and ATS · TruckersMP and singleplayer
        </motion.p>
      </div>

      <div className="mx-auto mt-14 max-w-6xl px-4 md:mt-20 md:px-8" style={{ perspective: 1600 }}>
        <motion.div
          ref={frameRef}
          style={{ rotateX, scale, y, transformOrigin: "50% 100%" }}
          className="rounded-[24px] bg-[#2a2018] p-1.5 shadow-[0_24px_56px_rgba(42,23,9,0.35)] md:p-2"
        >
          <TrackerPreview />
        </motion.div>
      </div>
    </section>
  );
}
