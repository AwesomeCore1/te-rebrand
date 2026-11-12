// Distances are stored in km; miles are display-only (CLAUDE.md).
export const KM_PER_MILE = 1.609344;

const whole = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

export function formatDistance(km: number, unit: "km" | "mi") {
  const n = whole.format(unit === "mi" ? km / KM_PER_MILE : km).replace(/,/g, " ");
  return `${n} ${unit}`;
}

const grouped = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

/** Job income is in the game's own currency: EUR in ETS2, USD in ATS. */
export function formatIncome(amount: number, game: "ets2" | "ats") {
  return `${game === "ats" ? "$" : "€"} ${grouped.format(amount).replace(/,/g, " ")}`;
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/** "today", "yesterday", "3 days ago", then a date. */
export function formatWhen(date: Date | string, now = new Date()) {
  const d = new Date(date);
  const days = Math.round((startOfDay(d) - startOfDay(now)) / 86_400_000);
  if (days > -7) return relative.format(days, "day");
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}
