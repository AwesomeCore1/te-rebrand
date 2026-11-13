// Where to send someone back to on this site after a round trip elsewhere
// (linking Steam). The path arrives in a query string, so anyone can put
// anything in it: it must never take a visitor to another site.

/** Stands in for our own origin while a path is checked. Never requested. */
const SELF = "http://tacho.invalid";
const MAX_LENGTH = 512;

/**
 * The path if it is one of this site's own pages, else null.
 *
 * Accepted: a path that starts with exactly one "/", with an optional query
 * and fragment. Refused: full URLs, "//host" (another site, protocol-relative),
 * anything with a backslash (browsers read "\" as "/", so "/\host" is "//host"),
 * control characters (browsers drop tabs and newlines, so "/<tab>/host" is
 * "//host" too), paths that only become "//host" once "." and ".." are
 * resolved, and /api/ addresses, which are not pages.
 */
export function safeReturnPath(value: string | null | undefined): string | null {
  if (!value || value.length > MAX_LENGTH) return null;
  if (value[0] !== "/" || value[1] === "/") return null;
  if (value.includes("\\")) return null;
  // oxlint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) return null;

  let url: URL;
  try {
    url = new URL(value, SELF);
  } catch {
    return null;
  }
  if (url.origin !== SELF) return null;
  // What a browser would follow, with "." and ".." resolved. Checked again:
  // "/.//host" resolves to "//host".
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (!path.startsWith("/") || path.startsWith("//")) return null;
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) return null;
  return path;
}

/** `path` with one more query parameter, keeping its own query and fragment. */
export function withParam(path: string, key: string, value: string) {
  const url = new URL(path, SELF);
  url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}
