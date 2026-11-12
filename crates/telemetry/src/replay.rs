//! Recorded telemetry, one JSON [`Frame`] per line (JSON Lines).
//!
//! Record a real drive once, then replay it in tests or in the app's
//! dev mode to test job detection without driving.

use crate::Frame;

#[derive(Debug, thiserror::Error)]
pub enum ReplayError {
    #[error("line {line}: {source}")]
    Parse {
        line: usize,
        #[source]
        source: serde_json::Error,
    },
}

pub fn parse(input: &str) -> Result<Vec<Frame>, ReplayError> {
    input
        .lines()
        .enumerate()
        .filter(|(_, l)| !l.trim().is_empty())
        .map(|(i, l)| {
            serde_json::from_str(l).map_err(|source| ReplayError::Parse {
                line: i + 1,
                source,
            })
        })
        .collect()
}

pub fn to_line(frame: &Frame) -> String {
    serde_json::to_string(frame).expect("frames always serialize")
}
