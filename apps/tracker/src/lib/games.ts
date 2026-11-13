import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

import type { Game } from "./status";

// Mirrors `GamesReport` and `InstallError` in src-tauri/src/plugin.rs. Change both together.

/** The `scs-telemetry.dll` in a game's plugins folder. */
export type PluginState = "missing" | "ours" | "different" | "unreadable";

export type GameReport = {
  game: Game;
  name: string;
  installed: boolean;
  folder: string | null;
  plugins_folder: string | null;
  /** `null` when the game is not installed. */
  plugin: PluginState | null;
};

export type GamesReport = {
  /** `false` where game telemetry does not exist (macOS, Linux). */
  supported: boolean;
  steam_found: boolean;
  plugin_release: string;
  games: GameReport[];
};

export type InstallError = {
  kind:
    | "game_not_found"
    | "needs_confirmation"
    | "in_use"
    | "no_permission"
    | "bad_bundle"
    | "failed";
  message: string;
};

export type Games = {
  /** `null` until the first check has finished. */
  report: GamesReport | null;
  /** The check itself failed. */
  error: string | null;
  /** The game being installed into right now. */
  installing: Game | null;
  /** Installed since the app started: the game will ask about "SDK features". */
  fresh: Game[];
  refresh: () => Promise<void>;
  /** Resolves to `null` when the plugin is in place, else to why not. */
  install: (game: Game, replace?: boolean) => Promise<InstallError | null>;
  dismissFresh: () => void;
};

function toInstallError(e: unknown): InstallError {
  if (typeof e === "object" && e !== null && "kind" in e && "message" in e) {
    return e as InstallError;
  }
  return { kind: "failed", message: String(e) };
}

/** Which games are on this PC and whether each has the telemetry plugin. */
export function useGames(): Games {
  const [report, setReport] = useState<GamesReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [installing, setInstalling] = useState<Game | null>(null);
  const [fresh, setFresh] = useState<Game[]>([]);

  const refresh = useCallback(async () => {
    try {
      setReport(await invoke<GamesReport>("get_games"));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
    // A game may have been installed, or its plugin changed, while Tacho sat in the tray.
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  const install = useCallback(async (game: Game, replace = false) => {
    setInstalling(game);
    try {
      setReport(await invoke<GamesReport>("install_plugin", { game, replace }));
      setError(null);
      setFresh((games) => (games.includes(game) ? games : [...games, game]));
      return null;
    } catch (e) {
      return toInstallError(e);
    } finally {
      setInstalling(null);
    }
  }, []);

  const dismissFresh = useCallback(() => setFresh([]), []);

  return { report, error, installing, fresh, refresh, install, dismissFresh };
}

/** "Euro Truck Simulator 2 and American Truck Simulator". */
export function gameNames(games: GameReport[]) {
  return games.map((g) => g.name).join(" and ");
}
