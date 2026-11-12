// Light/dark theme. The choice is "light", "dark" or "system" (follow the OS),
// kept in localStorage. THEME_SCRIPT runs in <head> before the page paints, so
// a dark-mode visitor never sees a flash of the light theme.
import { useCallback, useEffect, useSyncExternalStore } from "react";

export type ThemeChoice = "light" | "dark" | "system";
const KEY = "tacho-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export const THEME_SCRIPT = `(function(){try{var c=localStorage.getItem("${KEY}");var d=c==="dark"||(c!=="light"&&matchMedia("${DARK_QUERY}").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light"}catch(_){}})()`;

function readChoice(): ThemeChoice {
  try {
    const c = localStorage.getItem(KEY);
    return c === "light" || c === "dark" ? c : "system";
  } catch {
    return "system";
  }
}

function apply(choice: ThemeChoice) {
  const dark = choice === "dark" || (choice === "system" && matchMedia(DARK_QUERY).matches);
  const root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}

// The <html> class is the source of truth for what's showing right now.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => observer.disconnect();
}
const getResolved = (): "light" | "dark" =>
  document.documentElement.classList.contains("dark") ? "dark" : "light";
// Unknown on the server; the toggle renders a neutral placeholder until hydrated.
const getServerResolved = (): "light" | "dark" | undefined => undefined;

export function useTheme() {
  const resolved = useSyncExternalStore(subscribe, getResolved, getServerResolved);

  // While following the OS, switch live when the OS setting changes.
  useEffect(() => {
    const media = matchMedia(DARK_QUERY);
    const onChange = () => readChoice() === "system" && apply("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((choice: ThemeChoice) => {
    try {
      if (choice === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, choice);
    } catch {
      // Storage blocked (private mode): still switch for this page view.
    }
    apply(choice);
  }, []);

  return { resolved, setTheme };
}
