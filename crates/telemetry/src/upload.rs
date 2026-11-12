//! What the tracker app sends to the API. Pure data, no network.
//!
//! Mirrors `JobUploadSchema` and `PositionUpdateSchema` in
//! packages/telemetry-types/src/index.ts. Change both together; the shared
//! fixture tests/fixtures/job-upload.json is parsed on both sides.

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
}
