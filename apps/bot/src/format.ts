// Numbers and names as they appear in messages. Distances arrive in km and
// stay km; miles are a display conversion for ATS (CLAUDE.md).

export type Game = "ets2" | "ats";

export const KM_PER_MILE = 1.609344;

/** "1,196", "8.4": whole numbers from 10 up, one decimal below. */
function number(value: number) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: Math.abs(value) < 10 ? 1 : 0,
  }).format(value);
}

export function km(value: number) {
  return `${number(value)} km`;
}

export function miles(kmValue: number) {
  return `${number(kmValue / KM_PER_MILE)} mi`;
}

/** "1,196 km" for ETS2, "598 km (372 mi)" for ATS. */
export function distance(kmValue: number, game: Game) {
  return game === "ats" ? `${km(kmValue)} (${miles(kmValue)})` : km(kmValue);
}

/** The game's own currency: EUR in ETS2, USD in ATS. */
export function money(amount: number, game: Game) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: game === "ats" ? "USD" : "EUR",
    maximumFractionDigits: 0,
  }).format(amount);
}

export function gameName(game: Game) {
  return game === "ats" ? "ATS" : "ETS2";
}

/** "1 job", "14 jobs". */
export function count(n: number, one: string, many = `${one}s`) {
  return `${number(n)} ${n === 1 ? one : many}`;
}

/**
 * Text someone else typed (driver, city, cargo, rank and convoy names), made
 * safe to drop into a message: one line, no Markdown, no links or mention
 * chips, not too long.
 */
export function plain(text: string, maxLength = 100) {
  // Without "https://" Discord does not turn a name into a link.
  const oneLine = text
    .replace(/\b[a-z][a-z0-9+.-]*:\/\//gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const cut = oneLine.length > maxLength ? `${oneLine.slice(0, maxLength - 1)}…` : oneLine;
  return cut.replace(/[\\*_~`|>[\]()<#]/g, "\\$&");
}
