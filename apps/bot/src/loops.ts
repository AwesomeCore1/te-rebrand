import type { Logger } from "./log";

/**
 * Runs `run` now and then again `everyMs` after each run ends, so runs never
 * overlap. An error is logged and the loop goes on. `stop()` waits for the run
 * in progress.
 */
export function every(name: string, everyMs: number, run: () => Promise<unknown>, log: Logger) {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let wake: (() => void) | undefined;
  let lastFailure = "";

  const loop = (async () => {
    while (!stopped) {
      try {
        await run();
        lastFailure = "";
      } catch (error) {
        // The same failure every few seconds (database down) is logged once.
        const message = error instanceof Error ? error.message : String(error);
        if (message !== lastFailure) log.error(`${name} failed, will keep trying`, error);
        lastFailure = message;
      }
      if (stopped) break;
      await new Promise<void>((resolve) => {
        wake = resolve;
        timer = setTimeout(resolve, everyMs);
      });
    }
  })();

  return {
    async stop() {
      stopped = true;
      clearTimeout(timer);
      wake?.();
      await loop;
    },
  };
}
