import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

// Mirrors `AppSettings` in src-tauri/src/lib.rs. Change both together.
export type AppSettings = {
  /** `false` where Tacho can't register itself at login (not Windows). */
  start_at_login_supported: boolean;
  start_at_login: boolean;
};

/** The choices in Settings that belong to this PC rather than to the account. */
export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    invoke<AppSettings>("get_settings").then(setSettings, (e) => setError(String(e)));
  }, []);

  const setStartAtLogin = useCallback(async (enabled: boolean) => {
    setSaving(true);
    setError(null);
    try {
      setSettings(await invoke<AppSettings>("set_start_at_login", { enabled }));
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }, []);

  return { settings, error, saving, setStartAtLogin };
}
