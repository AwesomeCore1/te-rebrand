import { useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";

/**
 * The visitor's reduced-motion setting, but `false` until after hydration.
 * The server can't know the setting, so the first render must match the
 * server's HTML; reduced-motion visitors switch to the still version right after.
 */
export function useReducedMotionSafe() {
  const prefers = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted && Boolean(prefers);
}
