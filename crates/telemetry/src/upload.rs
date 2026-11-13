//! What the tracker app sends to the API. Pure data, no network.
//!
//! Mirrors `JobUploadSchema` and `PositionUpdateSchema` in
//! packages/telemetry-types/src/index.ts. Change both together; the shared
//! fixture tests/fixtures/job-upload.json is parsed on both sides.
//!
//! The job's fines, tolls, ferries and trains travel inside `job.events`,
//! timed like `job.started_at_ms`; the API places them between `started_at`
//! and `finished_at`.

use serde::{Deserialize, Serialize};

use crate::tracker::FinishedJob;
use crate::Game;

/// Body of `POST /api/tracker/jobs`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct JobUpload {
    /// UUID generated when the job finishes; retries reuse it so the API never stores a job twice.
    pub client_job_id: String,
    /// RFC 3339 wall-clock times.
    pub started_at: String,
    pub finished_at: String,
    pub multiplayer: bool,
    pub job: FinishedJob,
}

/// Body of `POST /api/tracker/position`, sent every 5 s while driving.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PositionUpdate {
    pub game: Game,
    pub multiplayer: bool,
    /// TruckersMP server name, when known.
    pub server: Option<String>,
    pub x: f64,
    pub z: f64,
    pub speed_kmh: f64,
    pub at: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tracker::TimedEvent;
    use crate::PlayerEvent;

    #[test]
    fn parses_the_fixture_shared_with_the_zod_schema() {
        let upload: JobUpload =
            serde_json::from_str(include_str!("../tests/fixtures/job-upload.json")).unwrap();
        assert_eq!(upload.job.job.destination_city, "Lyon");
        assert!(upload.multiplayer);

        // Round trip: what we send is exactly what the TS side parses.
        let back: serde_json::Value = serde_json::to_value(&upload).unwrap();
        let original: serde_json::Value =
            serde_json::from_str(include_str!("../tests/fixtures/job-upload.json")).unwrap();
        assert_eq!(back, original);
    }

    #[test]
    fn the_fixture_has_one_event_of_each_kind() {
        let upload: JobUpload =
            serde_json::from_str(include_str!("../tests/fixtures/job-upload.json")).unwrap();
        let place = |name: &str| name.to_owned();
        assert_eq!(
            upload.job.events,
            [
                TimedEvent {
                    at_ms: 601_000,
                    event: PlayerEvent::Toll { amount: 38 },
                },
                TimedEvent {
                    at_ms: 1_501_000,
                    event: PlayerEvent::Fine {
                        offence: place("speeding"),
                        amount: 550,
                    },
                },
                TimedEvent {
                    at_ms: 2_401_000,
                    event: PlayerEvent::Ferry {
                        source: place("Dover"),
                        target: place("Calais"),
                        amount: 320,
                    },
                },
                TimedEvent {
                    at_ms: 3_301_000,
                    event: PlayerEvent::Train {
                        source: place("Folkestone"),
                        target: place("Calais"),
                        amount: 265,
                    },
                },
            ]
        );
    }

    /// The offline queue of a tracker from before job events is read by the
    /// version that replaces it.
    #[test]
    fn a_job_queued_without_events_still_parses() {
        let mut old: serde_json::Value =
            serde_json::from_str(include_str!("../tests/fixtures/job-upload.json")).unwrap();
        old["job"].as_object_mut().unwrap().remove("events");
        let upload: JobUpload = serde_json::from_value(old).unwrap();
        assert_eq!(upload.job.events, []);
        assert_eq!(upload.job.job.destination_city, "Lyon");
    }
}
