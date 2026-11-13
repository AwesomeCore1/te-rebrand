//! Where frames come from.
//!
//! The live source reads the shared memory written by the RenCloud
//! scs-sdk-plugin (https://github.com/RenCloud/scs-sdk-plugin), which the
//! tracker installs into each game's `bin/win_x64/plugins` folder.
//! Shared memory is Windows-only, so on macOS and Linux only the replay
//! source is available; that is enough to build the UI and the job logic.

use crate::Frame;

pub trait FrameSource {
    /// Returns the latest frame, or `None` if the game is not running.
    fn next_frame(&mut self) -> Option<Frame>;

    /// True when no more frames will ever come (a replay that ran out).
    /// Live sources never finish; they return `None` until the game starts.
    fn is_finished(&self) -> bool {
        false
    }

    /// Why the last call to `next_frame` returned `None` although the game
    /// seems to be running, in words the driver can act on.
    fn problem(&self) -> Option<&str> {
        None
    }
}

/// Plays back recorded frames, for tests and `tauri dev` without the game.
pub struct ReplaySource {
    frames: std::vec::IntoIter<Frame>,
}

impl ReplaySource {
    pub fn new(frames: Vec<Frame>) -> Self {
        Self {
            frames: frames.into_iter(),
        }
    }
}

impl FrameSource for ReplaySource {
    fn next_frame(&mut self) -> Option<Frame> {
        self.frames.next()
    }

    fn is_finished(&self) -> bool {
        self.frames.len() == 0
    }
}

#[cfg(windows)]
pub use live::SharedMemorySource;

#[cfg(windows)]
mod live {
    use std::time::{Duration, Instant};

    use super::FrameSource;
    use crate::scs::{self, Decoder};
    use crate::win::{self, Copied, GameProcess};
    use crate::{Frame, Game};

    /// How long a look at the process list is trusted. Shorter while the
    /// game seems gone, so a start is noticed quickly.
    const PROCESS_CHECK_EVERY: Duration = Duration::from_secs(10);
    const PROCESS_RECHECK_EVERY: Duration = Duration::from_secs(2);

    const UNREADABLE: &str = "The telemetry plugin's memory could not be read.";

    /// Reads the plugin's memory map (see [`crate::scs`] for the format and
    /// the pinned plugin version).
    ///
    /// The map alone can't answer two things, so the source also looks at
    /// the game's process every few seconds:
    ///
    /// - Is the game still there? If it crashed while another program holds
    ///   the map open, the map keeps saying the truck is driving.
    /// - Is it TruckersMP? That is the case when TruckersMP's DLL is loaded
    ///   in the game.
    pub struct SharedMemorySource {
        /// NUL-terminated UTF-16.
        mapping_name: Vec<u16>,
        find_game: fn(Game) -> GameProcess,
        started: Instant,
        decoder: Decoder,
        buf: Vec<u8>,
        /// The last look at the process list: when, for which game, and the result.
        process: Option<(Instant, Game, GameProcess)>,
        problem: Option<String>,
    }

    impl SharedMemorySource {
        pub fn new() -> Self {
            Self::with(scs::MAPPING_NAME, win::find_game)
        }

        fn with(mapping_name: &str, find_game: fn(Game) -> GameProcess) -> Self {
            Self {
                mapping_name: mapping_name.encode_utf16().chain([0]).collect(),
                find_game,
                started: Instant::now(),
                decoder: Decoder::new(),
                buf: vec![0; scs::SNAPSHOT_LEN],
                process: None,
                problem: None,
            }
        }

        fn game_process(&mut self, game: Game) -> GameProcess {
            let now = Instant::now();
            if let Some((at, for_game, found)) = self.process {
                let trusted_for = match found {
                    GameProcess::NotRunning => PROCESS_RECHECK_EVERY,
                    _ => PROCESS_CHECK_EVERY,
                };
                if for_game == game && now.duration_since(at) < trusted_for {
                    return found;
                }
            }
            let found = (self.find_game)(game);
            self.process = Some((now, game, found));
            found
        }

        /// No game: forget what was known about it.
        fn no_game(&mut self, problem: Option<String>) -> Option<Frame> {
            self.decoder.reset();
            self.process = None;
            self.problem = problem;
            None
        }
    }

    impl Default for SharedMemorySource {
        fn default() -> Self {
            Self::new()
        }
    }

    impl FrameSource for SharedMemorySource {
        fn next_frame(&mut self) -> Option<Frame> {
            match win::copy_map(&self.mapping_name, &mut self.buf) {
                Copied::Yes => {}
                Copied::NoMap => return self.no_game(None),
                Copied::Unreadable => return self.no_game(Some(UNREADABLE.to_owned())),
            }
            let t_ms = u64::try_from(self.started.elapsed().as_millis()).unwrap_or(u64::MAX);
            let mut frame = match self.decoder.decode(&self.buf, t_ms) {
                Ok(Some(frame)) => frame,
                Ok(None) => return self.no_game(None),
                Err(e) => return self.no_game(Some(e.to_string())),
            };
            match self.game_process(frame.game) {
                GameProcess::Running { multiplayer } => frame.multiplayer = multiplayer,
                GameProcess::Unknown => {}
                // The map outlived the game. Keep the result of the look at
                // the process list, so the next one comes soon.
                GameProcess::NotRunning => {
                    self.decoder.reset();
                    self.problem = None;
                    return None;
                }
            }
            self.problem = None;
            Some(frame)
        }

        fn problem(&self) -> Option<&str> {
            self.problem.as_deref()
        }
    }

    #[cfg(test)]
    mod tests {
        use std::sync::atomic::{AtomicU32, Ordering};

        use super::*;
        use crate::scs::testing::FakeMap;
        use crate::win::testing::TestMap;
        use crate::GameplayEvent;

        fn on_truckersmp(_: Game) -> GameProcess {
            GameProcess::Running { multiplayer: true }
        }

        fn gone(_: Game) -> GameProcess {
            GameProcess::NotRunning
        }

        /// A map with its own name, so tests don't touch each other's map or
        /// a real game's.
        fn test_map(len: usize) -> (String, TestMap) {
            static NEXT: AtomicU32 = AtomicU32::new(0);
            let name = format!(
                "Local\\TachoTest-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            );
            let wide: Vec<u16> = name.encode_utf16().chain([0]).collect();
            let map = TestMap::create(&wide, len);
            (name, map)
        }

        #[test]
        fn no_frames_and_no_problem_without_the_game() {
            let mut source =
                SharedMemorySource::with("Local\\TachoTest-does-not-exist", on_truckersmp);
            assert_eq!(source.next_frame(), None);
            assert_eq!(source.problem(), None);
            assert!(!source.is_finished());
        }

        #[test]
        fn reads_a_delivery_from_the_memory_map() {
            let (name, map) = test_map(32 * 1024);
            let mut source = SharedMemorySource::with(&name, on_truckersmp);
            let mut game = FakeMap::running();
            map.write(&game.0);

            let frame = source.next_frame().expect("a frame");
            assert_eq!(frame.game, Game::Ets2);
            assert_eq!(frame.odometer_km, 50_210.0);
            assert!(frame.multiplayer);

            game.take_job();
            map.write(&game.0);
            assert_eq!(source.next_frame().unwrap().job, None);
            let frame = source.next_frame().unwrap();
            assert_eq!(frame.job.map(|j| j.destination_city), Some("Lyon".into()));

            game.deliver(0.0);
            map.write(&game.0);
            assert_eq!(
                source.next_frame().unwrap().gameplay_event,
                Some(GameplayEvent::JobDelivered)
            );
        }

        #[test]
        fn frames_stop_when_the_game_closes_and_the_map_goes_away() {
            let (name, map) = test_map(32 * 1024);
            let mut source = SharedMemorySource::with(&name, on_truckersmp);
            map.write(&FakeMap::running().0);
            assert!(source.next_frame().is_some());
            drop(map);
            assert_eq!(source.next_frame(), None);
            assert_eq!(source.problem(), None);
        }

        #[test]
        fn explains_an_unsupported_plugin() {
            let (name, map) = test_map(32 * 1024);
            let mut source = SharedMemorySource::with(&name, on_truckersmp);
            let mut game = FakeMap::running();
            game.revision(11);
            map.write(&game.0);

            assert_eq!(source.next_frame(), None);
            assert!(source.problem().unwrap().contains("revision 11"));

            // Fixed (the driver updated the plugin): the problem clears.
            game.revision(scs::PLUGIN_REVISION);
            map.write(&game.0);
            assert!(source.next_frame().is_some());
            assert_eq!(source.problem(), None);
        }

        #[test]
        fn explains_a_map_that_is_too_small() {
            let (name, _map) = test_map(64);
            let mut source = SharedMemorySource::with(&name, on_truckersmp);
            assert_eq!(source.next_frame(), None);
            assert_eq!(source.problem(), Some(UNREADABLE));
        }

        #[test]
        fn a_map_left_behind_by_a_crashed_game_gives_no_frames() {
            let (name, map) = test_map(32 * 1024);
            let mut source = SharedMemorySource::with(&name, gone);
            map.write(&FakeMap::running().0);
            assert_eq!(source.next_frame(), None);
            assert_eq!(source.problem(), None);
        }
    }
}
