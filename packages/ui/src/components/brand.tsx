import { cn } from "@te-rebrand/ui/lib/utils";

export function GameBadge({ game, className }: { game: "ETS2" | "ATS"; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold",
        game === "ETS2" ? "bg-game-ets2-bg text-game-ets2" : "bg-game-ats-bg text-game-ats",
        className,
      )}
    >
      {game}
    </span>
  );
}

/** Tacho's mark: a tachograph dial. */
export function TachoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={cn("size-6", className)}>
      <rect width="24" height="24" rx="7" fill="#f5a524" />
      <path
        d="M5.5 15.5a6.5 6.5 0 1 1 13 0"
        fill="none"
        stroke="#1a1204"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="m12 15.5 3.6-4.4" stroke="#1a1204" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="15.5" r="1.6" fill="#1a1204" />
    </svg>
  );
}
