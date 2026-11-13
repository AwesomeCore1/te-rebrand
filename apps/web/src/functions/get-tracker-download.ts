import { createServerFn } from "@tanstack/react-start";

import { ENV } from "@/env.server";
import { installerUrl } from "@/lib/download";

/**
 * TRACKER_DOWNLOAD_URL as the server knows it. A server that was started
 * before the variable was added to .env.schema does not know the name at all
 * and throws on reading it; that is the same as "not set".
 */
function configuredUrl() {
  try {
    return ENV.TRACKER_DOWNLOAD_URL;
  } catch {
    return undefined;
  }
}

/**
 * Where the tracker's Windows installer is, from the optional
 * TRACKER_DOWNLOAD_URL (.env.schema). Null until there is a release.
 */
export const getTrackerDownload = createServerFn({ method: "GET" }).handler(() => ({
  windowsUrl: installerUrl(configuredUrl()),
}));
