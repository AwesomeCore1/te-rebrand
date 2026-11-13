//! The running tracker: frames in, jobs queued and uploaded, positions sent.
//!
//! The tracker never decides what counts. It sends every finished job as-is;
//! the API validates it and may store it as `flagged`.

use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use serde::Serialize;
use te_telemetry::source::FrameSource;
use te_telemetry::tracker::FinishedJob;
use te_telemetry::upload::{JobUpload, PositionUpdate};
use te_telemetry::{Frame, Game, JobEvent, JobInfo, JobTracker, units};
use tokio::sync::Mutex;

use crate::api::{Api, ApiError, PairPoll};
use crate::store::{Auth, Store};

const POSITION_EVERY: Duration = Duration::from_secs(5);
/// How often the window gets fresh speed and distance readings.
const LIVE_EVERY: Duration = Duration::from_secs(1);
pub const FLUSH_EVERY: Duration = Duration::from_secs(30);

/// Maps a frame's `t_ms` (ms since the source started) to wall-clock time.
#[derive(Debug, Clone, Copy)]
pub struct Clock {
    base: SystemTime,
    /// 1 for the live game. Replays of compressed recordings stretch time back out.
    scale: u64,
}

impl Clock {
    #[cfg_attr(not(windows), allow(dead_code))] // used by the Windows game source
    pub fn live() -> Self {
        Self {
            base: SystemTime::now(),
            scale: 1,
        }
    }

    /// The recording's last frame lands on "now", stretched by `scale`.
    pub fn replay(last_t_ms: u64, scale: u64) -> Self {
        let span = Duration::from_millis(last_t_ms.saturating_mul(scale));
        Self {
            base: SystemTime::now() - span,
            scale,
        }
    }

    pub fn at(&self, t_ms: u64) -> SystemTime {
        self.base + Duration::from_millis(t_ms.saturating_mul(self.scale))
    }
}

fn rfc3339(t: SystemTime) -> String {
    humantime::format_rfc3339_millis(t).to_string()
}

pub fn build_upload(job: FinishedJob, clock: &Clock, multiplayer: bool) -> JobUpload {
    JobUpload {
        client_job_id: uuid::Uuid::new_v4().to_string(),
        started_at: rfc3339(clock.at(job.started_at_ms)),
        finished_at: rfc3339(clock.at(job.finished_at_ms)),
        multiplayer,
        job,
    }
}

/// What the UI shows. Sent as the `status` event whenever it changes.
#[derive(Debug, Clone, Serialize, Default)]
pub struct Status {
    pub linked: bool,
    pub driver_name: Option<String>,
    pub game: Option<Game>,
    /// The game seems to be running but can't be read (wrong plugin version).
    pub game_problem: Option<String>,
    pub current_job: Option<JobInfo>,
    /// Readings from the running game, refreshed about once a second.
    pub live: Option<Live>,
    pub queued: usize,
    pub last_result: Option<String>,
    pub last_error: Option<String>,
    pub pairing: Option<PairingStatus>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Live {
    pub speed_kmh: f64,
    /// On the current job, since the tracker picked it up.
    pub driven_km: Option<f64>,
    /// 0.0 to 1.0.
    pub cargo_damage: f64,
    pub paused: bool,
    pub multiplayer: bool,
}

/// What the tracking loop knows about the game right now.
#[derive(Default)]
struct GameState<'a> {
    game: Option<Game>,
    problem: Option<&'a str>,
    job: Option<JobInfo>,
    live: Option<Live>,
}

#[derive(Debug, Clone, Serialize)]
pub struct PairingStatus {
    pub user_code: String,
    pub verification_url: String,
}

struct Inner {
    auth: Option<Auth>,
    queue: Vec<JobUpload>,
    game: Option<Game>,
    game_problem: Option<String>,
    current_job: Option<JobInfo>,
    live: Option<Live>,
    live_sent: Option<Instant>,
    last_result: Option<String>,
    last_error: Option<String>,
    pairing: Option<PairingStatus>,
    /// Bumped on every new pairing attempt, so an older poll loop stops.
    pairing_gen: u64,
}

/// Called with the new status whenever it changes (the app forwards it to the UI).
pub type Notify = Box<dyn Fn(Status) + Send + Sync>;

pub struct Tracker {
    notify: Notify,
    api: Api,
    store: Store,
    inner: Mutex<Inner>,
    flush_lock: Mutex<()>,
}

impl Tracker {
    pub fn new(notify: Notify, api: Api, store: Store) -> Arc<Self> {
        let inner = Inner {
            auth: store.load_auth(),
            queue: store.load_queue(),
            game: None,
            game_problem: None,
            current_job: None,
            live: None,
            live_sent: None,
            last_result: None,
            last_error: None,
            pairing: None,
            pairing_gen: 0,
        };
        Arc::new(Self {
            notify,
            api,
            store,
            inner: Mutex::new(inner),
            flush_lock: Mutex::new(()),
        })
    }

    pub async fn status(&self) -> Status {
        let i = self.inner.lock().await;
        Status {
            linked: i.auth.is_some(),
            driver_name: i.auth.as_ref().map(|a| a.driver_name.clone()),
            game: i.game,
            game_problem: i.game_problem.clone(),
            current_job: i.current_job.clone(),
            live: i.live,
            queued: i.queue.len(),
            last_result: i.last_result.clone(),
            last_error: i.last_error.clone(),
            pairing: i.pairing.clone(),
        }
    }

    async fn emit_status(&self) {
        let status = self.status().await;
        (self.notify)(status);
    }

    async fn token(&self) -> Option<String> {
        self.inner
            .lock()
            .await
            .auth
            .as_ref()
            .map(|a| a.token.clone())
    }

    /// The website revoked this device: forget the token. Queued jobs stay
    /// and are sent after the driver links again.
    async fn handle_unauthorized(&self) {
        {
            let mut i = self.inner.lock().await;
            i.auth = None;
            i.last_error = Some("This tracker was unlinked. Link your account again.".into());
        }
        let _ = self.store.save_auth(None);
        self.emit_status().await;
    }

    // ---- Tracking ---------------------------------------------------------

    /// Reads frames until the source finishes (live sources never do).
    pub async fn run_source(
        self: Arc<Self>,
        mut source: Box<dyn FrameSource + Send>,
        clock: Clock,
        tick: Duration,
    ) {
        let mut tracker = JobTracker::new();
        let mut last_position: Option<Instant> = None;
        let mut interval = tokio::time::interval(tick);
        loop {
            interval.tick().await;
            let Some(frame) = source.next_frame() else {
                if source.is_finished() {
                    break;
                }
                self.set_game(GameState {
                    problem: source.problem(),
                    ..GameState::default()
                })
                .await;
                continue;
            };

            let mut queued_any = false;
            for event in tracker.push(&frame) {
                if let JobEvent::Finished(job) = event {
                    self.enqueue(build_upload(job, &clock, frame.multiplayer))
                        .await;
                    queued_any = true;
                }
            }
            self.set_game(GameState {
                game: Some(frame.game),
                problem: None,
                job: tracker.current_job().cloned(),
                live: Some(Live {
                    speed_kmh: units::ms_to_kmh(frame.speed_ms).abs(),
                    driven_km: tracker.driven_km(frame.odometer_km),
                    cargo_damage: frame.cargo_damage,
                    paused: frame.paused,
                    multiplayer: frame.multiplayer,
                }),
            })
            .await;
            if queued_any {
                tokio::spawn(self.clone().flush());
            }

            if !frame.paused && last_position.is_none_or(|t| t.elapsed() >= POSITION_EVERY) {
                last_position = Some(Instant::now());
                tokio::spawn(self.clone().send_position(position(&frame, &clock)));
            }
        }
        self.set_game(GameState::default()).await;
    }

    /// Stores the game's state and tells the window when it changed. Speed
    /// and distance change on every frame, so those alone are sent at most
    /// once per [`LIVE_EVERY`].
    async fn set_game(&self, state: GameState<'_>) {
        let changed = {
            let mut i = self.inner.lock().await;
            let changed = i.game != state.game
                || i.current_job != state.job
                || i.game_problem.as_deref() != state.problem
                || i.live.is_some() != state.live.is_some()
                || i.live.map(|l| (l.paused, l.multiplayer))
                    != state.live.map(|l| (l.paused, l.multiplayer));
            let refresh =
                i.live != state.live && i.live_sent.is_none_or(|t| t.elapsed() >= LIVE_EVERY);
            if changed || refresh {
                i.live_sent = Some(Instant::now());
            }
            i.game = state.game;
            i.current_job = state.job;
            i.game_problem = state.problem.map(str::to_owned);
            i.live = state.live;
            changed || refresh
        };
        if changed {
            self.emit_status().await;
        }
    }

    async fn enqueue(&self, upload: JobUpload) {
        {
            let mut i = self.inner.lock().await;
            i.queue.push(upload);
            if let Err(e) = self.store.save_queue(&i.queue) {
                i.last_error = Some(format!("Couldn't save the job queue: {e}"));
            }
        }
        self.emit_status().await;
    }

    async fn send_position(self: Arc<Self>, pos: PositionUpdate) {
        let Some(token) = self.token().await else {
            return;
        };
        // Positions are best effort: a missed one is replaced 5 s later.
        if let Err(ApiError::Unauthorized) = self.api.send_position(&token, &pos).await {
            self.handle_unauthorized().await;
        }
    }

    // ---- Uploading ----------------------------------------------------------

    /// Sends queued jobs oldest first. Stops at the first failure that is
    /// worth retrying (offline, server error) and keeps the rest queued.
    pub async fn flush(self: Arc<Self>) {
        let Ok(_guard) = self.flush_lock.try_lock() else {
            return;
        }; // already flushing
        loop {
            let (token, next) = {
                let i = self.inner.lock().await;
                (
                    i.auth.as_ref().map(|a| a.token.clone()),
                    i.queue.first().cloned(),
                )
            };
            let (Some(token), Some(job)) = (token, next) else {
                break;
            };

            let result = self.api.upload_job(&token, &job).await;
            if let Err(ApiError::Unauthorized) = result {
                self.handle_unauthorized().await;
                break;
            }
            let retry_later = matches!(&result, Err(e) if e.is_retryable());
            {
                let mut i = self.inner.lock().await;
                match &result {
                    Ok(accepted) => {
                        i.last_result = Some(describe(&job, accepted));
                        i.last_error = None;
                    }
                    Err(e) if e.is_retryable() => {
                        i.last_error = Some(format!("{e}. Will retry."));
                    }
                    Err(e) => {
                        // Retrying won't help; keep it on disk for support and move on.
                        let _ = self.store.append_rejected(&job, &e.to_string());
                        i.last_error = Some(format!("A job was rejected: {e}"));
                    }
                }
                if !retry_later {
                    i.queue.retain(|q| q.client_job_id != job.client_job_id);
                    let _ = self.store.save_queue(&i.queue);
                }
            }
            self.emit_status().await;
            if retry_later {
                break;
            }
        }
    }

    // ---- Linking ------------------------------------------------------------

    /// Starts the device-code flow: returns the code to show (the caller opens
    /// the website), then polls in the background until the driver approves.
    pub async fn start_link(self: Arc<Self>) -> Result<PairingStatus, ApiError> {
        let pair = self.api.pair_start(&device_name()).await?;
        let status = PairingStatus {
            user_code: pair.user_code.clone(),
            verification_url: pair.verification_url.clone(),
        };
        let generation = {
            let mut i = self.inner.lock().await;
            i.pairing_gen += 1;
            i.pairing = Some(status.clone());
            i.last_error = None;
            i.pairing_gen
        };
        self.emit_status().await;
        tokio::spawn(self.clone().poll_link(
            pair.device_code,
            generation,
            pair.interval,
            pair.expires_in,
        ));
        Ok(status)
    }

    async fn poll_link(
        self: Arc<Self>,
        device_code: String,
        generation: u64,
        interval_s: u64,
        expires_s: u64,
    ) {
        let deadline = Instant::now() + Duration::from_secs(expires_s);
        let interval = Duration::from_secs(interval_s.max(1));
        while Instant::now() < deadline {
            tokio::time::sleep(interval).await;
            if self.inner.lock().await.pairing_gen != generation {
                return; // a newer attempt replaced this one
            }
            match self.api.pair_poll(&device_code).await {
                Ok(PairPoll::Pending) => continue,
                Err(e) if e.is_retryable() => continue,
                Ok(PairPoll::Approved { token, driver_name }) => {
                    let auth = Auth { token, driver_name };
                    {
                        let mut i = self.inner.lock().await;
                        if let Err(e) = self.store.save_auth(Some(&auth)) {
                            i.last_error =
                                Some(format!("Linked, but couldn't save the login: {e}"));
                        }
                        i.auth = Some(auth);
                        i.pairing = None;
                    }
                    self.emit_status().await;
                    tokio::spawn(self.clone().flush());
                    return;
                }
                Ok(PairPoll::Expired) | Err(_) => break,
            }
        }
        let mut i = self.inner.lock().await;
        if i.pairing_gen == generation {
            i.pairing = None;
            i.last_error = Some("The link code expired. Try again.".into());
            drop(i);
            self.emit_status().await;
        }
    }

    pub async fn cancel_link(&self) {
        {
            let mut i = self.inner.lock().await;
            i.pairing_gen += 1;
            i.pairing = None;
        }
        self.emit_status().await;
    }

    pub async fn unlink(&self) {
        {
            let mut i = self.inner.lock().await;
            i.auth = None;
            i.last_result = None;
        }
        let _ = self.store.save_auth(None);
        self.emit_status().await;
    }
}

fn position(frame: &Frame, clock: &Clock) -> PositionUpdate {
    PositionUpdate {
        game: frame.game,
        multiplayer: frame.multiplayer,
        server: None,
        x: frame.position.0,
        z: frame.position.1,
        speed_kmh: units::ms_to_kmh(frame.speed_ms).max(0.0),
        at: rfc3339(clock.at(frame.t_ms)),
    }
}

fn describe(upload: &JobUpload, accepted: &crate::api::JobAccepted) -> String {
    let route = format!(
        "{} to {}",
        upload.job.job.source_city, upload.job.job.destination_city
    );
    if accepted.status == "flagged" {
        format!(
            "{route}: saved, flagged for review ({})",
            accepted.flag_reasons.join(", ")
        )
    } else {
        format!("{route}: saved as {}", accepted.status)
    }
}

/// Shown on the website's list of linked trackers.
fn device_name() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .ok()
        .filter(|n| !n.trim().is_empty())
        .unwrap_or_else(|| "My PC".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use te_telemetry::replay;

    #[test]
    fn replayed_job_gets_wall_clock_times_ending_now() {
        let frames = replay::parse(include_str!(
            "../../../../crates/telemetry/tests/fixtures/hamburg-lyon.jsonl"
        ))
        .unwrap();
        let clock = Clock::replay(frames.last().unwrap().t_ms, 1000);
        let mut tracker = JobTracker::new();
        let job = frames
            .iter()
            .flat_map(|f| tracker.push(f))
            .find_map(|e| match e {
                JobEvent::Finished(job) => Some(job),
                _ => None,
            })
            .unwrap();

        let upload = build_upload(job, &clock, false);
        let started = humantime::parse_rfc3339(&upload.started_at).unwrap();
        let finished = humantime::parse_rfc3339(&upload.finished_at).unwrap();
        let took = finished.duration_since(started).unwrap();
        // 3 s of recording stretched 1000x: a 50-minute drive, finished in the past.
        assert_eq!(took, Duration::from_secs(3000));
        assert!(finished <= SystemTime::now());
        assert!(uuid::Uuid::parse_str(&upload.client_job_id).is_ok());

        // The recording's toll and fine ride along inside the job, timed on
        // the recording's own clock; the API places them between the two
        // wall-clock times above.
        let events = serde_json::to_value(&upload.job.events).unwrap();
        assert_eq!(
            events,
            serde_json::json!([
                { "at_ms": 2000, "type": "toll", "amount": 38 },
                { "at_ms": 3000, "type": "fine", "offence": "speeding", "amount": 550 },
            ])
        );
    }

    #[test]
    fn live_clock_is_one_to_one() {
        let clock = Clock::live();
        assert_eq!(
            clock.at(1500).duration_since(clock.at(500)).unwrap(),
            Duration::from_secs(1)
        );
    }

    /// End to end against a running web server. The approval step needs a
    /// logged-in driver, so the test writes the link code to a file and waits
    /// for something else to approve it (see apps/tracker/README.md).
    ///
    /// TACHO_E2E_URL=http://localhost:3001 TACHO_E2E_CODE_FILE=/tmp/code \
    ///   cargo test -p tracker e2e -- --ignored --nocapture
    #[tokio::test]
    #[ignore = "needs a running web server and someone to approve the link"]
    async fn e2e_link_replay_and_upload() {
        use te_telemetry::source::ReplaySource;

        let url = std::env::var("TACHO_E2E_URL").expect("set TACHO_E2E_URL");
        let code_file = std::env::var("TACHO_E2E_CODE_FILE").expect("set TACHO_E2E_CODE_FILE");
        let dir = std::env::temp_dir().join(format!("tacho-e2e-{}", uuid::Uuid::new_v4()));
        let tracker = Tracker::new(Box::new(|_| {}), Api::new(url), Store::new(dir).unwrap());

        let pairing = tracker.clone().start_link().await.unwrap();
        std::fs::write(&code_file, &pairing.user_code).unwrap();
        let deadline = Instant::now() + Duration::from_secs(90);
        while !tracker.status().await.linked {
            assert!(Instant::now() < deadline, "link was not approved in time");
            tokio::time::sleep(Duration::from_millis(500)).await;
        }

        let frames = replay::parse(include_str!(
            "../../../../crates/telemetry/tests/fixtures/hamburg-lyon.jsonl"
        ))
        .unwrap();
        let clock = Clock::replay(frames.last().unwrap().t_ms, 1000);
        tracker
            .clone()
            .run_source(
                Box::new(ReplaySource::new(frames)),
                clock,
                Duration::from_millis(10),
            )
            .await;
        // The tracker starts an upload itself when the job finishes; wait for it.
        let deadline = Instant::now() + Duration::from_secs(30);
        while tracker.status().await.queued > 0 && Instant::now() < deadline {
            tracker.clone().flush().await;
            tokio::time::sleep(Duration::from_millis(200)).await;
        }

        let status = tracker.status().await;
        println!("status after replay: {status:?}");
        assert_eq!(
            status.queued, 0,
            "job still queued: {:?}",
            status.last_error
        );
        let result = status.last_result.expect("a job result");
        assert!(result.contains("saved as delivered"), "{result}");
    }
}
