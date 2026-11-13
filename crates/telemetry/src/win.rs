//! The Win32 calls behind [`crate::source::SharedMemorySource`]: copying the
//! plugin's memory map, and finding the game's process.

use std::mem;
use std::ptr;

use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, ERROR_BAD_LENGTH, ERROR_FILE_NOT_FOUND, HANDLE, INVALID_HANDLE_VALUE,
};
use windows_sys::Win32::System::Diagnostics::ToolHelp::{
    CreateToolhelp32Snapshot, Module32FirstW, Module32NextW, Process32FirstW, Process32NextW,
    MODULEENTRY32W, PROCESSENTRY32W, TH32CS_SNAPMODULE, TH32CS_SNAPMODULE32, TH32CS_SNAPPROCESS,
};
use windows_sys::Win32::System::Memory::{
    MapViewOfFile, OpenFileMappingW, UnmapViewOfFile, FILE_MAP_READ,
};

use crate::Game;

/// The DLL TruckersMP injects into the game, by game.
fn truckersmp_module(game: Game) -> &'static str {
    match game {
        Game::Ets2 => "core_ets2mp.dll",
        Game::Ats => "core_atsmp.dll",
    }
}

fn game_executable(game: Game) -> &'static str {
    match game {
        Game::Ets2 => "eurotrucks2.exe",
        Game::Ats => "amtrucks.exe",
    }
}

/// Closes the handle when dropped.
struct Handle(HANDLE);

impl Drop for Handle {
    fn drop(&mut self) {
        // SAFETY: the handle is open and owned by this value alone.
        unsafe { CloseHandle(self.0) };
    }
}

#[derive(Debug, PartialEq, Eq)]
pub enum Copied {
    /// `buf` now holds the start of the map.
    Yes,
    /// No map with that name: the game (or the plugin) is not running.
    NoMap,
    /// The map exists but could not be read, or is smaller than `buf`.
    Unreadable,
}

/// Copies the first `buf.len()` bytes of the named memory map into `buf`.
///
/// The map is opened and closed again on every call. Holding it open would
/// keep it alive after the game exits, with the last telemetry still in it.
pub fn copy_map(name: &[u16], buf: &mut [u8]) -> Copied {
    debug_assert_eq!(name.last(), Some(&0), "the name must be NUL-terminated");
    // SAFETY: `name` is a NUL-terminated UTF-16 string that outlives the call.
    let handle = unsafe { OpenFileMappingW(FILE_MAP_READ, 0, name.as_ptr()) };
    if handle.is_null() {
        // SAFETY: reads this thread's last error code.
        return match unsafe { GetLastError() } {
            ERROR_FILE_NOT_FOUND => Copied::NoMap,
            _ => Copied::Unreadable,
        };
    }
    let handle = Handle(handle);

    // SAFETY: the handle is a file mapping opened for reading. Asking for
    // exactly `buf.len()` bytes makes this fail, rather than map less, when
    // the map is smaller.
    let view = unsafe { MapViewOfFile(handle.0, FILE_MAP_READ, 0, 0, buf.len()) };
    if view.Value.is_null() {
        return Copied::Unreadable;
    }
    // SAFETY: the view is `buf.len()` readable bytes and `buf` is a separate
    // allocation. The game may write while we copy; every field we decode is
    // plain data, and the decoder waits for values to hold still.
    unsafe {
        ptr::copy_nonoverlapping(view.Value.cast::<u8>(), buf.as_mut_ptr(), buf.len());
        UnmapViewOfFile(view);
    }
    Copied::Yes
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GameProcess {
    /// The process list could not be read. Assume the game is there.
    Unknown,
    NotRunning,
    Running {
        /// TruckersMP's DLL is loaded in the game. `false` also when the
        /// game's modules can't be listed (it runs as administrator and the
        /// tracker does not).
        multiplayer: bool,
    },
}

/// Looks for the game's process and whether TruckersMP is loaded in it.
pub fn find_game(game: Game) -> GameProcess {
    let Some(pids) = process_ids(game_executable(game)) else {
        return GameProcess::Unknown;
    };
    if pids.is_empty() {
        return GameProcess::NotRunning;
    }
    let wanted = truckersmp_module(game);
    GameProcess::Running {
        multiplayer: pids.iter().any(|&pid| has_module(pid, wanted)),
    }
}

/// Ids of the running processes with this executable name. `None` when the
/// process list can't be read.
fn process_ids(executable: &str) -> Option<Vec<u32>> {
    // SAFETY: plain call; the result is checked below.
    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return None;
    }
    let snapshot = Handle(snapshot);

    // SAFETY: PROCESSENTRY32W is plain data; all-zero is a valid value.
    let mut entry: PROCESSENTRY32W = unsafe { mem::zeroed() };
    entry.dwSize = mem::size_of::<PROCESSENTRY32W>() as u32;
    let mut pids = Vec::new();
    // SAFETY: the snapshot is a process snapshot and `entry.dwSize` is set.
    let mut more = unsafe { Process32FirstW(snapshot.0, &mut entry) } != 0;
    while more {
        if wide_eq_ignore_case(&entry.szExeFile, executable) {
            pids.push(entry.th32ProcessID);
        }
        // SAFETY: as above.
        more = unsafe { Process32NextW(snapshot.0, &mut entry) } != 0;
    }
    Some(pids)
}

/// True when the process has a module with this file name loaded.
fn has_module(pid: u32, module: &str) -> bool {
    let flags = TH32CS_SNAPMODULE | TH32CS_SNAPMODULE32;
    let mut snapshot = INVALID_HANDLE_VALUE;
    // The docs say to retry on ERROR_BAD_LENGTH: the module list changed
    // while it was being read.
    for _ in 0..5 {
        // SAFETY: plain call; the result is checked below.
        snapshot = unsafe { CreateToolhelp32Snapshot(flags, pid) };
        // SAFETY: reads this thread's last error code.
        if snapshot != INVALID_HANDLE_VALUE || unsafe { GetLastError() } != ERROR_BAD_LENGTH {
            break;
        }
    }
    if snapshot == INVALID_HANDLE_VALUE {
        return false;
    }
    let snapshot = Handle(snapshot);

    // SAFETY: MODULEENTRY32W is plain data; all-zero is a valid value.
    let mut entry: MODULEENTRY32W = unsafe { mem::zeroed() };
    entry.dwSize = mem::size_of::<MODULEENTRY32W>() as u32;
    // SAFETY: the snapshot is a module snapshot and `entry.dwSize` is set.
    let mut more = unsafe { Module32FirstW(snapshot.0, &mut entry) } != 0;
    while more {
        if wide_eq_ignore_case(&entry.szModule, module) {
            return true;
        }
        // SAFETY: as above.
        more = unsafe { Module32NextW(snapshot.0, &mut entry) } != 0;
    }
    false
}

/// Compares a NUL-terminated UTF-16 buffer with an ASCII name, ignoring case.
fn wide_eq_ignore_case(wide: &[u16], name: &str) -> bool {
    let len = wide.iter().position(|&c| c == 0).unwrap_or(wide.len());
    let wide = &wide[..len];
    wide.len() == name.len()
        && wide
            .iter()
            .zip(name.bytes())
            .all(|(&w, n)| u8::try_from(w).is_ok_and(|w| w.eq_ignore_ascii_case(&n)))
}

/// A named memory map owned by this process, standing in for the plugin's.
#[cfg(test)]
pub(crate) mod testing {
    use std::ffi::c_void;
    use std::ptr;

    use windows_sys::Win32::Foundation::INVALID_HANDLE_VALUE;
    use windows_sys::Win32::System::Memory::{
        CreateFileMappingW, MapViewOfFile, UnmapViewOfFile, FILE_MAP_ALL_ACCESS,
        MEMORY_MAPPED_VIEW_ADDRESS, PAGE_READWRITE,
    };

    use super::Handle;

    pub(crate) struct TestMap {
        view: *mut c_void,
        len: usize,
        /// Closed after the view is unmapped (fields drop after `drop` runs).
        _handle: Handle,
    }

    impl TestMap {
        pub(crate) fn create(name: &[u16], len: usize) -> Self {
            // SAFETY: creates a new mapping backed by the page file; `name`
            // is NUL-terminated.
            let handle = unsafe {
                CreateFileMappingW(
                    INVALID_HANDLE_VALUE,
                    ptr::null(),
                    PAGE_READWRITE,
                    0,
                    len as u32,
                    name.as_ptr(),
                )
            };
            assert!(!handle.is_null(), "CreateFileMappingW failed");
            let handle = Handle(handle);
            // SAFETY: the handle is a mapping of `len` bytes, opened read/write.
            let view = unsafe { MapViewOfFile(handle.0, FILE_MAP_ALL_ACCESS, 0, 0, len) };
            assert!(!view.Value.is_null(), "MapViewOfFile failed");
            Self {
                view: view.Value,
                len,
                _handle: handle,
            }
        }

        pub(crate) fn write(&self, bytes: &[u8]) {
            assert!(bytes.len() <= self.len);
            // SAFETY: the view is `self.len` writable bytes.
            unsafe {
                ptr::copy_nonoverlapping(bytes.as_ptr(), self.view.cast::<u8>(), bytes.len());
            }
        }
    }

    impl Drop for TestMap {
        fn drop(&mut self) {
            // SAFETY: the view was mapped in `create` and is unmapped once.
            unsafe { UnmapViewOfFile(MEMORY_MAPPED_VIEW_ADDRESS { Value: self.view }) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compares_names_ignoring_case() {
        let wide: Vec<u16> = "EuroTrucks2.EXE\0junk".encode_utf16().collect();
        assert!(wide_eq_ignore_case(&wide, "eurotrucks2.exe"));
        assert!(!wide_eq_ignore_case(&wide, "eurotrucks2.ex"));
        assert!(!wide_eq_ignore_case(&wide, "amtrucks.exe"));
    }

    #[test]
    fn finds_this_process_and_its_modules() {
        let exe = std::env::current_exe().unwrap();
        let name = exe.file_name().unwrap().to_str().unwrap();
        let pids = process_ids(name).expect("the process list");
        assert!(pids.contains(&std::process::id()), "{name} not in {pids:?}");

        assert!(has_module(std::process::id(), "KERNEL32.DLL"));
        assert!(!has_module(std::process::id(), "core_ets2mp.dll"));
    }

    #[test]
    fn a_game_that_is_not_running_is_reported_as_such() {
        // Neither game is running on a machine that is running the tests.
        if process_ids(game_executable(Game::Ats)).is_some_and(|p| p.is_empty()) {
            assert_eq!(find_game(Game::Ats), GameProcess::NotRunning);
        }
    }
}
