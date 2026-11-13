//! Turns a stream of frames into job events.

use serde::{Deserialize, Serialize};

use crate::{Frame, Game, GameplayEvent, JobInfo, PlayerEvent};

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
    /// Fines, tolls, ferries and trains during the job, oldest first.
    /// A job queued by a tracker from before these existed has none.
    #[serde(default)]
    pub events: Vec<TimedEvent>,
}

/// A [`PlayerEvent`] and when it happened, on the same clock as the job's
/// `started_at_ms` and `finished_at_ms`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TimedEvent {
    pub at_ms: u64,
    #[serde(flatten)]
    pub event: PlayerEvent,
}

#[derive(Debug)]
struct Active {
    game: Game,
    job: JobInfo,
    odometer_start_km: f64,
    max_speed_ms: f64,
    started_at_ms: u64,
    events: Vec<TimedEvent>,
}

impl Active {
    /// Keeps what the game reported in this frame as part of the job.
    fn record(&mut self, frame: &Frame) {
        if frame.game != self.game {
            return;
        }
        let at_ms = frame.t_ms;
        self.events.extend(
            frame
                .player_events
                .iter()
                .cloned()
                .map(|event| TimedEvent { at_ms, event }),
        );
    }
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

    /// Distance driven on the current job so far, given the odometer now.
    pub fn driven_km(&self, odometer_km: f64) -> Option<f64> {
        self.active
            .as_ref()
            .map(|a| (odometer_km - a.odometer_start_km).max(0.0))
    }

    pub fn push(&mut self, frame: &Frame) -> Vec<JobEvent> {
        let mut events = Vec::new();

        // A job ended: the SDK's gameplay event is the source of truth.
        if let Some(ev) = frame.gameplay_event {
            if let Some(mut active) = self.active.take() {
                // What the game reported up to the end still belongs to the job.
                active.record(frame);
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
                    events: active.events,
                }));
            }
            return events;
        }

        match (&mut self.active, &frame.job) {
            // Driving with the job we are tracking: keep stats up to date.
            (Some(active), Some(job)) if active.game == frame.game && active.job == *job => {
                if !frame.paused && frame.speed_ms > active.max_speed_ms {
                    active.max_speed_ms = frame.speed_ms;
                }
                active.record(frame);
            }
            // A new job appeared. If another one was being tracked, it ended
            // without an event (the driver switched profile or game), so
            // nothing is known about how it ended: drop it rather than let
            // the new job's delivery close it. Fines and tolls in this frame
            // came before the job was picked up, so they are not part of it.
            (_, Some(job)) => {
                self.active = Some(Active {
                    game: frame.game,
                    job: job.clone(),
                    odometer_start_km: frame.odometer_km,
                    max_speed_ms: 0.0,
                    started_at_ms: frame.t_ms,
                    events: Vec::new(),
                });
                events.push(JobEvent::Started {
                    game: frame.game,
                    job: job.clone(),
                    at_ms: frame.t_ms,
                });
            }
            // The job vanished without a gameplay event (game closed, profile switched).
            // Keep it: the next delivered/cancelled event will close it. The
            // game can also show no job for a moment while it loads, as it
            // does around a ferry or a train, so what it reports here is kept.
            (Some(active), None) => active.record(frame),
            // Not on a job: fines and tolls belong to no job and are dropped.
            (None, None) => {}
        }

        events
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::replay;

    fn fine(amount: i64) -> PlayerEvent {
        PlayerEvent::Fine {
            offence: "speeding".to_owned(),
            amount,
        }
    }

    /// The one finished job among `events`.
    fn finished(events: Vec<JobEvent>) -> FinishedJob {
        let mut jobs = events.into_iter().filter_map(|e| match e {
            JobEvent::Finished(job) => Some(job),
            JobEvent::Started { .. } => None,
        });
        let job = jobs.next().expect("a finished job");
        assert!(jobs.next().is_none(), "more than one finished job");
        job
    }

    #[test]
    fn records_a_delivered_job_from_a_replay() {
        let frames = replay::parse(include_str!("../tests/fixtures/hamburg-lyon.jsonl")).unwrap();
        let mut tracker = JobTracker::new();
        let events: Vec<_> = frames.iter().flat_map(|f| tracker.push(f)).collect();

        assert!(matches!(events.first(), Some(JobEvent::Started { .. })));
        assert_eq!(tracker.driven_km(0.0), None, "no job after the delivery");
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
    fn the_replay_has_a_toll_and_a_fine_on_the_job() {
        let frames = replay::parse(include_str!("../tests/fixtures/hamburg-lyon.jsonl")).unwrap();
        let mut tracker = JobTracker::new();
        let job = finished(frames.iter().flat_map(|f| tracker.push(f)).collect());
        assert_eq!(
            job.events,
            [
                TimedEvent {
                    at_ms: 2000,
                    event: PlayerEvent::Toll { amount: 38 },
                },
                TimedEvent {
                    at_ms: 3000,
                    event: fine(550),
                },
            ]
        );
    }

    #[test]
    fn events_outside_a_job_are_dropped() {
        let frames = replay::parse(include_str!("../tests/fixtures/hamburg-lyon.jsonl")).unwrap();
        let mut tracker = JobTracker::new();
        let mut events = Vec::new();

        // Fined on the way to the first job, and again in the frame the job
        // shows up in: both came before the tracker had a job.
        let mut before = frames[0].clone();
        before.player_events = vec![fine(100)];
        events.extend(tracker.push(&before));
        let mut start = frames[1].clone();
        start.player_events = vec![fine(200)];
        events.extend(tracker.push(&start));

        let mut driving = frames[2].clone();
        driving.player_events = vec![fine(300)];
        events.extend(tracker.push(&driving));
        events.extend(tracker.push(&frames[4]));

        // After the delivery, with no job.
        let mut after = frames[5].clone();
        after.player_events = vec![fine(400)];
        events.extend(tracker.push(&after));

        assert_eq!(
            finished(events).events,
            [TimedEvent {
                at_ms: 2000,
                event: fine(300),
            }]
        );

        // The next job starts clean.
        let mut next = frames[1].clone();
        next.t_ms = 6000;
        tracker.push(&next);
        let mut delivered = frames[4].clone();
        delivered.t_ms = 7000;
        assert_eq!(finished(tracker.push(&delivered)).events, []);
    }

    #[test]
    fn an_event_in_the_frame_that_ends_the_job_belongs_to_it() {
        let frames = replay::parse(include_str!("../tests/fixtures/hamburg-lyon.jsonl")).unwrap();
        let mut tracker = JobTracker::new();
        tracker.push(&frames[1]);
        let mut delivered = frames[4].clone();
        delivered.player_events = vec![PlayerEvent::Toll { amount: 12 }];
        assert_eq!(
            finished(tracker.push(&delivered)).events,
            [TimedEvent {
                at_ms: 4000,
                event: PlayerEvent::Toll { amount: 12 },
            }]
        );
    }

    #[test]
    fn events_are_kept_while_the_game_shows_no_job_for_a_moment() {
        let frames = replay::parse(include_str!("../tests/fixtures/hamburg-lyon.jsonl")).unwrap();
        let ferry = PlayerEvent::Ferry {
            source: "Dover".to_owned(),
            target: "Calais".to_owned(),
            amount: 320,
        };
        let mut tracker = JobTracker::new();
        tracker.push(&frames[1]);

        // The crossing: a loading screen, and the job is not in the frame.
        let mut loading = frames[2].clone();
        loading.job = None;
        loading.paused = true;
        loading.player_events = vec![ferry.clone()];
        assert!(tracker.push(&loading).is_empty());

        // The other game says something while this job is still open: not ours.
        let mut other_game = loading.clone();
        other_game.game = Game::Ats;
        other_game.player_events = vec![fine(999)];
        assert!(tracker.push(&other_game).is_empty());

        assert_eq!(
            finished(tracker.push(&frames[4])).events,
            [TimedEvent {
                at_ms: 2000,
                event: ferry,
            }]
        );
    }

    #[test]
    fn events_of_a_job_that_never_ended_do_not_move_to_the_next_job() {
        let frames = replay::parse(include_str!("../tests/fixtures/hamburg-lyon.jsonl")).unwrap();
        let mut tracker = JobTracker::new();
        tracker.push(&frames[1]);
        tracker.push(&frames[2]); // the toll, on Hamburg to Lyon

        let mut other = frames[3].clone(); // carries the fine
        other.job.as_mut().unwrap().destination_city = "Oslo".to_owned();
        tracker.push(&other);
        let mut delivered = frames[4].clone();
        delivered.job = other.job.clone();
        assert_eq!(finished(tracker.push(&delivered)).events, []);
    }

    #[test]
    fn a_different_job_replaces_the_one_that_never_ended() {
        let frames = replay::parse(include_str!("../tests/fixtures/hamburg-lyon.jsonl")).unwrap();
        let mut tracker = JobTracker::new();
        tracker.push(&frames[1]); // Hamburg to Lyon starts at 50,210 km
        assert_eq!(tracker.driven_km(50_600.0), Some(390.0));

        // Another profile: a different job, a different truck.
        let mut other = frames[2].clone();
        other.odometer_km = 9_000.0;
        other.job.as_mut().unwrap().destination_city = "Oslo".to_owned();
        let events = tracker.push(&other);
        assert!(matches!(events.as_slice(), [JobEvent::Started { .. }]));

        let mut delivered = frames[4].clone();
        delivered.odometer_km = 9_450.0;
        let events = tracker.push(&delivered);
        let [JobEvent::Finished(job)] = events.as_slice() else {
            panic!("expected one finished job, got {events:?}");
        };
        assert_eq!(job.job.destination_city, "Oslo");
        assert_eq!(job.odometer_start_km, 9_000.0);
        assert_eq!(job.driven_km, 450.0);
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
            player_events: Vec::new(),
        };
        assert!(tracker.push(&frame).is_empty());
    }
}
