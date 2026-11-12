// Mirrors `Status` in src-tauri/src/tracking.rs. Change both together.

export type Game = "ets2" | "ats";

export type JobInfo = {
  source_city: string;
  destination_city: string;
  source_company: string;
  destination_company: string;
  cargo: string;
  cargo_mass_kg: number;
  planned_distance_km: number;
  income: number;
};

export type Live = {
  speed_kmh: number;
  driven_km: number | null;
  /** 0 to 1 */
  cargo_damage: number;
  paused: boolean;
  multiplayer: boolean;
};

export type Status = {
  linked: boolean;
  driver_name: string | null;
  game: Game | null;
  game_problem: string | null;
  current_job: JobInfo | null;
  live: Live | null;
  queued: number;
  last_result: string | null;
  last_error: string | null;
  pairing: { user_code: string; verification_url: string } | null;
};

/** Runs a tracker command; the promise rejects with a message to show. */
export type Run = (command: string) => Promise<void>;
