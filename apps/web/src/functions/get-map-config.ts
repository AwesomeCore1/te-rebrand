import { createServerFn } from "@tanstack/react-start";

import { ENV } from "@/env.server";
import { mapConfigFromEnv } from "@/lib/live-map";

let warned = false;

/** Map background per game, from the optional LIVE_MAP_* variables (.env.schema). */
export const getMapConfig = createServerFn({ method: "GET" }).handler(() => {
  const { config, problems } = mapConfigFromEnv(ENV);
  if (problems.length > 0 && !warned) {
    warned = true;
    for (const p of problems) console.warn(`[live map] ${p}`);
  }
  return config;
});
