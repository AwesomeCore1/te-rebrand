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

/// Reads the plugin's memory map on Windows.
///
/// TODO: map `Local\SCSTelemetry` and decode the struct for the plugin
/// version we ship (offsets change between plugin releases, so pin one).
#[cfg(windows)]
pub struct SharedMemorySource;

#[cfg(windows)]
impl FrameSource for SharedMemorySource {
    fn next_frame(&mut self) -> Option<Frame> {
        None
    }
}
