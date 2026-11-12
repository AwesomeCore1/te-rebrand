import { Link } from "@tanstack/react-router";
import { Button } from "@te-rebrand/ui/components/button";

import { DiscordIcon, TachoMark } from "./bits";

export function ClosingBand({ loggedIn }: { loggedIn: boolean }) {
  return (
    <section className="px-4 pb-6 md:px-8">
      <div
        className="mx-auto flex max-w-6xl flex-col items-center rounded-[28px] px-6 py-20 text-center md:py-28"
        style={{
          background:
            "radial-gradient(70% 70% at 50% 120%, rgba(245,165,36,0.9), rgba(201,106,18,0.5) 40%, transparent 72%), linear-gradient(180deg, #120c07, #2a1709)",
        }}
      >
        <h2 className="max-w-2xl text-[clamp(2rem,5vw,3.75rem)] leading-[1] font-extrabold text-[#fbf5ec]">
          Get your kilometres counting.
        </h2>
        <p className="mt-4 max-w-lg text-[17px] text-[#e9dccb]">
          Log in with Discord, link Steam and install the tracker. Your next delivery goes on the
          board.
        </p>
        <div className="mt-8">
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
        </div>
      </div>
    </section>
  );
}

export function SiteFooter() {
  return (
    <footer className="mx-auto flex max-w-6xl flex-col gap-2 px-5 py-8 text-[13px] text-muted-foreground md:flex-row md:items-center md:justify-between md:px-8">
      <span className="flex items-center gap-2">
        <TachoMark className="size-4" /> Tacho · not affiliated with SCS Software or TruckersMP
      </span>
      <span>
        Euro Truck Simulator 2 and American Truck Simulator are trademarks of SCS Software.
      </span>
    </footer>
  );
}
