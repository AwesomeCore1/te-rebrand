// Distances are stored and sent in km; miles are display only (CLAUDE.md).
const KM_PER_MILE = 1.609344;

const whole = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

/** "1 196" style grouping, as on the website. */
export function formatNumber(n: number) {
  return whole.format(n).replace(/,/g, " ");
}

export function formatKm(km: number) {
  return `${formatNumber(km)} km`;
}

export function formatMiles(km: number) {
  return `${formatNumber(km / KM_PER_MILE)} mi`;
}

/** Job income is in the game's own currency: EUR in ETS2, USD in ATS. */
export function formatIncome(amount: number, game: "ets2" | "ats") {
  return `${game === "ats" ? "$" : "€"} ${formatNumber(amount)}`;
}

export function formatTonnes(kg: number) {
  return `${(kg / 1000).toLocaleString("en-GB", { maximumFractionDigits: 1 })} t`;
}

export function formatPercent(fraction: number) {
  return `${(fraction * 100).toLocaleString("en-GB", { maximumFractionDigits: 1 })} %`;
}
