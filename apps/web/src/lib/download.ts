// The tracker's installer link comes from configuration (TRACKER_DOWNLOAD_URL
// in .env.schema). It ends up in an <a href>, so only a web address passes.

/** The link if a browser should follow it, else null: https, or http on this machine in development. */
export function installerUrl(value: string | undefined | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol === "https:" || (url.protocol === "http:" && local)) return url.toString();
  return null;
}
