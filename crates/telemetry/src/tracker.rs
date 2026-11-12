//! Turns a stream of frames into job events.

use serde::{Deserialize, Serialize};

use crate::{Frame, Game, GameplayEvent, JobInfo};

/// What the tracker reports to the app. The app sends finished jobs to the API.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum JobEvent {
    Started {
        game: Game,
        job: JobInfo,
        at_ms: u64,
    },
    Finished(FinishedJob),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobStatus {
    Delivered,
    Cancelled,
}

/// One finished or cancelled job: this is what becomes a `Job` row in the database.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FinishedJob {
    pub game: Game,
    pub job: JobInfo,
    pub status: JobStatus,
    /// Distance actually driven, from the odometer, in km.
    pub driven_km: f64,
    pub odometer_start_km: f64,
    pub odometer_end_km: f64,
    pub max_speed_kmh: f64,
    pub cargo_damage: f64,
    pub started_at_ms: u64,
    pub finished_at_ms: u64,
}

#[derive(Debug)]
struct Active {
    game: Game,
    job: JobInfo,
    odometer_start_km: f64,
    max_speed_ms: f64,
    started_at_ms: u64,
}

/// Feed it frames in order with [`JobTracker::push`]; it returns events as they happen.
#[derive(Debug, Default)]
pub struct JobTracker {
    active: Option<Active>,
}

impl JobTracker {
    pub fn new() -> Self {
        Self::default()
    }

    /// The job being tracked right now, if any.
    pub fn current_job(&self) -> Option<&JobInfo> {
        self.active.as_ref().map(|a| &a.job)
    }

    pub fn push(&mut self, frame: &Frame) -> Vec<JobEvent> {
        let mut events = Vec::new();

        // A job ended: the SDK's gameplay event is the source of truth.
        if let Some(ev) = frame.gameplay_event {
            if let Some(active) = self.active.take() {
                let status = match ev {
                    GameplayEvent::JobDelivered => JobStatus::Delivered,
                    GameplayEvent::JobCancelled => JobStatus::Cancelled,
                };
                events.push(JobEvent::Finished(FinishedJob {
                    game: active.game,
                    status,
                    driven_km: (frame.odometer_km - active.odometer_start_km).max(0.0),
                    odometer_start_km: active.odometer_start_km,
                    odometer_end_km: frame.odometer_km,
                    max_speed_kmh: crate::units::ms_to_kmh(active.max_speed_ms),
                    cargo_damage: frame.cargo_damage,
                    started_at_ms: active.started_at_ms,
                    finished_at_ms: frame.t_ms,
                    job: active.job,
                }));
            }
            return events;
        }

        match (&mut self.active, &frame.job) {
            // A new job appeared.
            (None, Some(job)) => {
                self.active = Some(Active {
                    game: frame.game,
                    job: job.clone(),
                    odometer_start_km: frame.odometer_km,
                    max_speed_ms: 0.0,
                    started_at_ms: frame.t_ms,
                });
                events.push(JobEvent::Started {
                    game: frame.game,
                    job: job.clone(),
                    at_ms: frame.t_ms,
                });
            }
            // Driving with a job: keep stats up to date.
            (Some(active), Some(_)) => {
                if !frame.paused && frame.speed_ms > active.max_speed_ms {
                    active.max_speed_ms = frame.speed_ms;
                }
            }
            // The job vanished without a gameplay event (game closed, profile switched).
            // Keep it: the next delivered/cancelled event will close it.
            (Some(_), None) | (None, None) => {}
        }

        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::replay;

    #[test]
    fn records_a_delivered_job_from_a_replay() {
        let frames = replay::parse(include_str!("../tests/fixtures/hamburg-lyon.jsonl")).unwrap();
        let mut tracker = JobTracker::new();
        let events: Vec<_> = frames.iter().flat_map(|f| tracker.push(f)).collect();

        assert!(matches!(events.first(), Some(JobEvent::Started { .. })));
        let Some(JobEvent::Finished(job)) = events.last() else {
            panic!("expected a finished job, got {events:?}");
        };
        assert_eq!(job.status, JobStatus::Delivered);
        assert_eq!(job.job.destination_city, "Lyon");
        assert!((job.driven_km - 1196.0).abs() < 0.01);
        assert!((job.max_speed_kmh - 90.0).abs() < 0.01);
        assert!(tracker.current_job().is_none());
    }

    #[test]
    fn ignores_end_events_without_a_job() {
        let mut tracker = JobTracker::new();
        let frame = Frame {
            t_ms: 0,
            game: Game::Ats,
            paused: false,
            odometer_km: 10.0,
            speed_ms: 0.0,
            cargo_damage: 0.0,
            position: (0.0, 0.0),
            job: None,
            multiplayer: false,
            gameplay_event: Some(GameplayEvent::JobCancelled),
        };
        assert!(tracker.push(&frame).is_empty());
    }
}
