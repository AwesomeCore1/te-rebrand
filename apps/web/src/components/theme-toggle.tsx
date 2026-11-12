import { Moon, Sun } from "lucide-react";

import { useTheme } from "@/lib/theme";

/** Switches between light and dark. Until clicked, the site follows the OS setting. */
export function ThemeToggle() {
  const { resolved, setTheme } = useTheme();
  const dark = resolved === "dark";
  const label = resolved ? `Switch to ${dark ? "light" : "dark"} mode` : "Switch colour theme";

  return (
    <button
      type="button"
      onClick={() => setTheme(dark ? "light" : "dark")}
      aria-label={label}
      title={label}
      className="relative flex size-10 items-center justify-center rounded-lg text-[#cfc5b8] transition-[color,background-color,transform] duration-150 ease-out hover:bg-white/8 hover:text-white active:scale-[0.97]"
    >
      {resolved && (
        <>
          <Sun
            aria-hidden="true"
            className={`absolute size-[18px] transition-[transform,opacity] duration-200 ease-out ${dark ? "scale-50 -rotate-90 opacity-0" : "scale-100 rotate-0 opacity-100"}`}
          />
          <Moon
            aria-hidden="true"
            className={`absolute size-[18px] transition-[transform,opacity] duration-200 ease-out ${dark ? "scale-100 rotate-0 opacity-100" : "scale-50 rotate-90 opacity-0"}`}
          />
        </>
      )}
    </button>
  );
}
