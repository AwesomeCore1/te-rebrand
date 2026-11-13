// After linking Steam the driver lands back on the page they started from,
// with `?steam=linked|failed|taken` in the address (routes/api/steam/callback.ts).
// A page that sends people to Steam calls this to say how it went and tidy the
// address. The dashboard has its own, older copy of the same thing.
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";

// One id, so the message shows once even if the effect runs twice.
const id = "steam-result";
const MESSAGES: Record<string, () => void> = {
  linked: () => toast.success("Steam linked.", { id }),
  failed: () => toast.error("Steam didn't confirm the sign-in. Try again.", { id }),
  taken: () => toast.error("That Steam account is already linked to another driver.", { id }),
};

/** The link that starts the Steam sign-in and comes back to `returnTo` (a path on this site). */
export function steamConnectHref(returnTo: string) {
  return `/api/steam/connect?return=${encodeURIComponent(returnTo)}`;
}

export function useSteamResult() {
  const steam = useRouterState({
    select: (s) => (s.location.search as Record<string, unknown>).steam,
  });
  const navigate = useNavigate();
  useEffect(() => {
    if (typeof steam !== "string") return;
    MESSAGES[steam]?.();
    void navigate({
      to: ".",
      search: (current: Record<string, unknown>) => ({ ...current, steam: undefined }),
      hash: true,
      replace: true,
    } as never);
  }, [steam, navigate]);
}
