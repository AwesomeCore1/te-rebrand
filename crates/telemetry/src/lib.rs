//! Core tracking logic for the Tacho tracker.
//!
//! This crate knows nothing about Tauri, HTTP or the UI. It takes
//! [`Frame`]s (snapshots of game telemetry) and turns them into
//! [`JobEvent`]s. Frames come from the game through the SCS telemetry
//! plugin (see [`source`]) or from a recorded file (see [`replay`]),
//! so the logic can be tested without running the game.

pub mod replay;
pub mod scs;
pub mod source;
pub mod tracker;
pub mod units;
pub mod upload;
#[cfg(windows)]
mod win;

pub use tracker::{JobEvent, JobTracker};

use serde::{Deserialize, Serialize};

/// Which game the frame came from. Both use the same SCS SDK.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Game {
    Ets2,
    Ats,
}

/// The job currently loaded in the game, as reported by the SDK.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JobInfo {
    pub source_city: String,
    pub destination_city: String,
    pub source_company: String,
    pub destination_company: String,
    pub cargo: String,
    pub cargo_mass_kg: f64,
    /// Route length the game planned for the job, in km (the SDK reports km for both games).
    pub planned_distance_km: f64,
    /// Income promised by the job, in the game's own currency (EUR in ETS2, USD in ATS).
    pub income: i64,
}

/// One snapshot of game telemetry. The tracker app samples a few times per second.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Frame {
    /// Milliseconds since the tracker started. Used for ordering and durations.
    pub t_ms: u64,
    pub game: Game,
    pub paused: bool,
    /// Truck odometer in km. Always km, also in ATS.
    pub odometer_km: f64,
    /// Speed in metres per second, as the SDK reports it.
    pub speed_ms: f64,
    /// Cargo damage, 0.0 to 1.0.
    pub cargo_damage: f64,
    /// World position (x, z) for the live map.
    pub position: (f64, f64),
    /// The loaded job, if any.
    pub job: Option<JobInfo>,
    /// True when the game is running TruckersMP. The source decides how to detect it.
    #[serde(default)]
    pub multiplayer: bool,
    /// Set by the SDK's gameplay events for the frame where a job ends.
    #[serde(default)]
    pub gameplay_event: Option<GameplayEvent>,
    /// Fines, tolls, ferries and trains the game reported since the previous
    /// frame. Only what the game fired: nothing here is worked out from
    /// speed or position.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub player_events: Vec<PlayerEvent>,
}

/// Gameplay events the SDK fires when a job ends.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GameplayEvent {
    JobDelivered,
    JobCancelled,
}

/// Something the game charged the driver for: the SDK's `player.*` gameplay
/// events. Amounts are in the game's own currency (EUR in ETS2, USD in ATS).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PlayerEvent {
    Fine {
        /// The SDK's name for what the driver did, such as `speeding` or
        /// `red_signal`. Passed on as the game gave it.
        offence: String,
        amount: i64,
    },
    Toll {
        amount: i64,
    },
    /// `source` and `target` are the names of the two ports.
    Ferry {
        source: String,
        target: String,
        amount: i64,
    },
    /// `source` and `target` are the names of the two terminals.
    Train {
        source: String,
        target: String,
        amount: i64,
    },
}
