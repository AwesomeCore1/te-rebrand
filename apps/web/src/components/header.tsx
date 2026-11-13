import { Link, useLocation } from "@tanstack/react-router";
import { Button } from "@te-rebrand/ui/components/button";

import { authClient } from "@/lib/auth-client";

import { DiscordIcon, TachoMark } from "./landing/bits";
import { ThemeToggle } from "./theme-toggle";
import UserMenu from "./user-menu";

const SECTIONS: { href: string; label: string; className?: string }[] = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#for-vtcs", label: "For VTCs" },
  { href: "/events", label: "Convoys" },
  // Hidden on tablets, where the links don't all fit beside the login button.
  { href: "/map", label: "Live map", className: "hidden lg:block" },
  { href: "/leaderboards", label: "Leaderboards", className: "hidden lg:block" },
];

/** A floating dark pill, the same on the landing page and in the app. */
export default function Header() {
  const { data: session, isPending } = authClient.useSession();
  const onLoginPage = useLocation({ select: (l) => l.pathname === "/login" });

  return (
    <header className="pointer-events-none fixed inset-x-0 top-3 z-50 px-3 md:top-4">
      <nav
        aria-label="Main"
        className="pointer-events-auto mx-auto flex h-14 max-w-4xl items-center justify-between gap-2 rounded-2xl border border-white/10 bg-[#1d1712]/92 pr-2 pl-4 text-[#ece4d8] shadow-[0_10px_30px_rgba(18,12,7,0.25)] backdrop-blur-md"
      >
        <Link
          to="/"
          className="flex items-center gap-2 rounded-md font-display text-[17px] font-bold tracking-tight"
        >
          <TachoMark /> Tacho
        </Link>
        <div className="hidden items-center gap-1 md:flex">
          {session ? (
            <>
              <NavLink to="/dashboard">Dashboard</NavLink>
              <NavLink to="/events">Convoys</NavLink>
              <NavLink to="/map">Live map</NavLink>
              <NavLink to="/leaderboards">Leaderboards</NavLink>
            </>
          ) : (
            SECTIONS.map((s) => (
              <a
                key={s.href}
                href={s.href}
                className={`nav-link rounded-md px-3 py-2 text-[14px] ${s.className ?? ""}`}
              >
                <span className="nav-link-label">{s.label}</span>
              </a>
            ))
          )}
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle />
          {isPending ? (
            <span className="h-10 w-28" />
          ) : session ? (
            <UserMenu />
          ) : onLoginPage ? null : (
            <Link to="/login" search={{}}>
              <Button>
                <DiscordIcon /> <span className="hidden sm:inline">Log in with Discord</span>
                <span className="sm:hidden">Log in</span>
              </Button>
            </Link>
          )}
        </div>
      </nav>
    </header>
  );
}

function NavLink({
  to,
  children,
}: {
  to: "/dashboard" | "/events" | "/map" | "/leaderboards";
  children: string;
}) {
  return (
    <Link to={to} className="nav-link rounded-md px-3 py-2 text-[14px]">
      <span className="nav-link-label">{children}</span>
    </Link>
  );
}
