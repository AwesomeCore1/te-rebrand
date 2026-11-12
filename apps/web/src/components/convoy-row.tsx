import { Link } from "@tanstack/react-router";
import { Users } from "lucide-react";

export type ConvoyListItem = {
  id: number;
  name: string;
  game: "ets2" | "ats";
  server: string | null;
  from: { city: string | null };
  to: { city: string | null };
  startAt: Date | string;
  attending: { confirmed: number };
  hostedByVtc: boolean;
  vtc: { id: number; name: string } | null;
  company: { name: string; slug: string; tag: string | null } | null;
};

const tileMonth = new Intl.DateTimeFormat("en-GB", { month: "short" });
const tileTime = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" });

/**
 * One convoy in a list: date tile, name, host, game, server, time, route and
 * how many are going. `showHost` names the hosting VTC (on lists that mix VTCs).
 */
export function ConvoyRow({ convoy: e, showHost }: { convoy: ConvoyListItem; showHost?: boolean }) {
  const at = new Date(e.startAt);
  const host = e.company?.tag ?? e.company?.name ?? e.vtc?.name ?? null;
  return (
    <Link
      to="/events/$eventId"
      params={{ eventId: String(e.id) }}
      className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-secondary/60"
    >
      <div className="tabular flex w-11 shrink-0 flex-col items-center rounded-xl bg-secondary py-1.5">
        <span className="text-[17px] leading-none font-bold">{at.getDate()}</span>
        <span className="text-[10px] font-semibold text-signal-ink uppercase">
          {tileMonth.format(at)}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold">{e.name}</div>
        <div className="truncate text-[13px] text-muted-foreground">
          {showHost && host && <span className="font-medium text-foreground">{host} · </span>}
          {e.game.toUpperCase()}
          {e.server ? ` · ${e.server}` : ""} · {tileTime.format(at)}
          {e.from.city && e.to.city ? ` · ${e.from.city} → ${e.to.city}` : ""}
        </div>
      </div>
      <span
        className="tabular flex shrink-0 items-center gap-1 text-[12px] text-muted-foreground"
        title="Going, on TruckersMP"
      >
        <Users className="size-3.5" />
        {e.attending.confirmed}
      </span>
    </Link>
  );
}
