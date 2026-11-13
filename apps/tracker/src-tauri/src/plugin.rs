//! The telemetry plugin Tacho ships, and putting it in a game's folder.
//!
//! Exactly one build is shipped: `Win64/scs-telemetry.dll` from the RenCloud
//! scs-sdk-plugin release V.1.12.1 (MIT, licence text next to the DLL in
//! `resources/scs-telemetry`). The memory layout the tracker decodes is
//! pinned to that revision (`crates/telemetry/src/scs.rs`), so the file is
//! pinned too, by its SHA-256. A test checks the file in the repository, and
//! [`install`] checks the copy on disk again before it writes anything.
//!
//! Nothing here runs on its own. Writing into another program's folder
//! happens only when the driver clicks.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256};
use te_telemetry::Game;

use crate::games;

/// The release the shipped DLL comes from.
pub const RELEASE: &str = "V.1.12.1";

pub const FILE_NAME: &str = "scs-telemetry.dll";

/// SHA-256 of `Win64/scs-telemetry.dll` in `release_v_1_12_1.zip`.
pub const SHA256: &str = "1d03dbc7a975e72203c60a7b9998021ceb8800b836bf28a131279979ad386cd4";

/// Where the DLL is inside the app's resource folder (see `tauri.conf.json`).
pub const RESOURCE: &str = "scs-telemetry/scs-telemetry.dll";

/// The plugin file in a game's folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PluginState {
    Missing,
    /// The same file Tacho ships.
    Ours,
    /// Some other `scs-telemetry.dll`: another revision, or another tool's build.
    Different,
    /// Something is there but it can't be read.
    Unreadable,
}

/// The folder the game loads plugins from. The game does not create it.
pub fn plugins_dir(game_dir: &Path) -> PathBuf {
    game_dir.join("bin").join("win_x64").join("plugins")
}

fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub fn plugin_state(game_dir: &Path) -> PluginState {
    match fs::read(plugins_dir(game_dir).join(FILE_NAME)) {
        Ok(bytes) if sha256_hex(&bytes) == SHA256 => PluginState::Ours,
        Ok(_) => PluginState::Different,
        Err(e) if e.kind() == io::ErrorKind::NotFound => PluginState::Missing,
        Err(_) => PluginState::Unreadable,
    }
}

/// Why the plugin was not installed. The messages are shown to the driver as
/// they are, so each names the folder.
#[derive(Debug, thiserror::Error)]
pub enum InstallError {
    #[error("{game} was not found on this PC.")]
    GameNotFound { game: &'static str },
    #[error(
        "There is already a different {FILE_NAME} in {folder}. Another tool may have put it there."
    )]
    NeedsConfirmation { folder: String },
    #[error("{FILE_NAME} in {folder} is in use. Close {game} and try again.")]
    InUse { game: &'static str, folder: String },
    #[error(
        "Windows did not let Tacho write to {folder}. Start Tacho as administrator once and install again."
    )]
    NoPermission { folder: String },
    #[error("Tacho's own copy of the plugin is missing or damaged. Install Tacho again.")]
    BadBundle,
    #[error("Couldn't install the plugin in {folder}: {reason}")]
    Failed { folder: String, reason: String },
}

impl InstallError {
    /// A stable name for the UI to branch on.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::GameNotFound { .. } => "game_not_found",
            Self::NeedsConfirmation { .. } => "needs_confirmation",
            Self::InUse { .. } => "in_use",
            Self::NoPermission { .. } => "no_permission",
            Self::BadBundle => "bad_bundle",
            Self::Failed { .. } => "failed",
        }
    }
}

/// Sorts a failed write into what the driver can do about it.
fn explain(error: &io::Error, game: Game, folder: &Path) -> InstallError {
    let folder = folder.display().to_string();
    // ERROR_SHARING_VIOLATION, ERROR_LOCK_VIOLATION, ERROR_USER_MAPPED_FILE:
    // what Windows answers while the game has the DLL loaded.
    if cfg!(windows) && matches!(error.raw_os_error(), Some(32 | 33 | 1224)) {
        return InstallError::InUse {
            game: games::name(game),
            folder,
        };
    }
    if error.kind() == io::ErrorKind::PermissionDenied {
        return InstallError::NoPermission { folder };
    }
    InstallError::Failed {
        folder,
        reason: error.to_string(),
    }
}

/// Copies the shipped DLL (`source`) into the game's plugins folder, creating
/// the folder when it is missing.
///
/// A file that is already there and is not ours is only replaced when
/// `replace` is set, which the UI does after the driver confirms.
pub fn install(
    source: &Path,
    game: Game,
    game_dir: &Path,
    replace: bool,
) -> Result<(), InstallError> {
    // Checked on every install: never copy a file that is not the pinned one.
    let bytes = fs::read(source).map_err(|_| InstallError::BadBundle)?;
    if sha256_hex(&bytes) != SHA256 {
        return Err(InstallError::BadBundle);
    }

    let folder = plugins_dir(game_dir);
    let target = folder.join(FILE_NAME);
    let state = plugin_state(game_dir);
    if matches!(state, PluginState::Different | PluginState::Unreadable) && !replace {
        return Err(InstallError::NeedsConfirmation {
            folder: folder.display().to_string(),
        });
    }

    fs::create_dir_all(&folder).map_err(|e| explain(&e, game, &folder))?;
    if state != PluginState::Missing {
        // A read-only file can't be overwritten; the driver agreed to replace it.
        if let Ok(meta) = fs::metadata(&target) {
            let mut permissions = meta.permissions();
            if permissions.readonly() {
                #[allow(clippy::permissions_set_readonly_false)]
                // Windows attribute, not a Unix mode
                permissions.set_readonly(false);
                let _ = fs::set_permissions(&target, permissions);
            }
        }
    }
    fs::write(&target, &bytes).map_err(|e| explain(&e, game, &folder))?;

    match plugin_state(game_dir) {
        PluginState::Ours => Ok(()),
        _ => Err(InstallError::Failed {
            folder: folder.display().to_string(),
            reason: "the file was written but does not read back the same".into(),
        }),
    }
}

impl Serialize for InstallError {
    /// `{ kind, message }`, the shape the window gets when a command fails.
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut out = serializer.serialize_struct("InstallError", 2)?;
        out.serialize_field("kind", self.kind())?;
        out.serialize_field("message", &self.to_string())?;
        out.end()
    }
}

/// One game, as the window shows it.
#[derive(Debug, Clone, Serialize)]
pub struct GameReport {
    pub game: Game,
    pub name: &'static str,
    pub installed: bool,
    /// The game's folder, when it is installed.
    pub folder: Option<String>,
    /// Where the plugin goes, when the game is installed.
    pub plugins_folder: Option<String>,
    pub plugin: Option<PluginState>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GamesReport {
    /// `false` where game telemetry does not exist (macOS, Linux).
    pub supported: bool,
    pub steam_found: bool,
    pub plugin_release: &'static str,
    pub games: Vec<GameReport>,
}

/// Looks at this PC: which games are installed and what is in their plugins
/// folders. Reads a few small files, nothing is written.
pub fn report() -> GamesReport {
    let located = games::locate();
    GamesReport {
        supported: cfg!(windows),
        steam_found: located.steam_found,
        plugin_release: RELEASE,
        games: located
            .games
            .into_iter()
            .map(|(game, folder)| GameReport {
                game,
                name: games::name(game),
                installed: folder.is_some(),
                plugins_folder: folder
                    .as_deref()
                    .map(|dir| plugins_dir(dir).display().to_string()),
                plugin: folder.as_deref().map(plugin_state),
                folder: folder.map(|dir| dir.display().to_string()),
            })
            .collect(),
    }
}

/// Installs into the game as Steam has it now. See [`install`].
pub fn install_for(source: &Path, game: Game, replace: bool) -> Result<(), InstallError> {
    let located = games::locate();
    let folder = located
        .games
        .into_iter()
        .find_map(|(found, folder)| folder.filter(|_| found == game))
        .ok_or(InstallError::GameNotFound {
            game: games::name(game),
        })?;
    install(source, game, &folder, replace)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The DLL as it sits in the repository, the file the bundle ships.
    fn shipped() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("resources")
            .join(RESOURCE)
    }

    /// A game folder as Steam leaves it: binaries, no `plugins` folder.
    fn game_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "tacho plugin test {}/Euro Truck Simulator 2",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(dir.join("bin").join("win_x64")).unwrap();
        dir
    }

    fn cleanup(game_dir: &Path) {
        let _ = fs::remove_dir_all(game_dir.parent().unwrap());
    }

    fn put_other_plugin(game_dir: &Path) -> PathBuf {
        let folder = plugins_dir(game_dir);
        fs::create_dir_all(&folder).unwrap();
        let target = folder.join(FILE_NAME);
        fs::write(&target, b"another tool's build").unwrap();
        target
    }

    #[test]
    fn the_shipped_dll_is_the_pinned_release() {
        let bytes = fs::read(shipped()).expect("resources/scs-telemetry/scs-telemetry.dll");
        assert_eq!(
            sha256_hex(&bytes),
            SHA256,
            "resources/scs-telemetry/scs-telemetry.dll is not the {RELEASE} build"
        );
        // A 64-bit Windows DLL: "MZ", then "PE\0\0" and machine type x64.
        assert_eq!(&bytes[..2], b"MZ");
        let pe = u32::from_le_bytes(bytes[0x3c..0x40].try_into().unwrap()) as usize;
        assert_eq!(&bytes[pe..pe + 4], b"PE\0\0");
        assert_eq!(&bytes[pe + 4..pe + 6], [0x64, 0x86]);
    }

    #[test]
    fn the_licence_ships_next_to_the_dll() {
        let licence = fs::read_to_string(shipped().with_file_name("LICENSE.txt")).unwrap();
        assert!(licence.contains("The MIT License (MIT)"));
        assert!(licence.contains("Permission is hereby granted, free of charge"));
        assert!(licence.contains(RELEASE));
    }

    #[test]
    fn the_resource_is_listed_in_the_bundle() {
        let conf: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let resources = &conf["bundle"]["resources"];
        assert_eq!(
            resources[format!("resources/{RESOURCE}")],
            RESOURCE,
            "tauri.conf.json must bundle the DLL where `RESOURCE` looks for it"
        );
        assert_eq!(
            resources["resources/scs-telemetry/LICENSE.txt"],
            "scs-telemetry/LICENSE.txt"
        );
    }

    #[test]
    fn installs_into_a_game_without_a_plugins_folder() {
        let game = game_dir();
        assert_eq!(plugin_state(&game), PluginState::Missing);
        assert!(!plugins_dir(&game).exists());

        install(&shipped(), Game::Ets2, &game, false).unwrap();

        assert_eq!(plugin_state(&game), PluginState::Ours);
        assert_eq!(
            fs::read(plugins_dir(&game).join(FILE_NAME)).unwrap(),
            fs::read(shipped()).unwrap()
        );
        cleanup(&game);
    }

    #[test]
    fn installing_again_over_our_own_file_needs_no_confirmation() {
        let game = game_dir();
        install(&shipped(), Game::Ets2, &game, false).unwrap();
        install(&shipped(), Game::Ets2, &game, false).unwrap();
        assert_eq!(plugin_state(&game), PluginState::Ours);
        cleanup(&game);
    }

    #[test]
    fn a_different_file_is_kept_until_the_driver_confirms() {
        let game = game_dir();
        let target = put_other_plugin(&game);
        assert_eq!(plugin_state(&game), PluginState::Different);

        let refused = install(&shipped(), Game::Ets2, &game, false).unwrap_err();
        assert_eq!(refused.kind(), "needs_confirmation");
        assert!(
            refused
                .to_string()
                .contains(&plugins_dir(&game).display().to_string()),
            "{refused}"
        );
        assert_eq!(fs::read(&target).unwrap(), b"another tool's build");

        install(&shipped(), Game::Ets2, &game, true).unwrap();
        assert_eq!(plugin_state(&game), PluginState::Ours);
        cleanup(&game);
    }

    #[test]
    fn a_read_only_file_is_replaced_after_confirmation() {
        let game = game_dir();
        let target = put_other_plugin(&game);
        let mut permissions = fs::metadata(&target).unwrap().permissions();
        permissions.set_readonly(true);
        fs::set_permissions(&target, permissions).unwrap();

        install(&shipped(), Game::Ets2, &game, true).unwrap();
        assert_eq!(plugin_state(&game), PluginState::Ours);
        cleanup(&game);
    }

    #[test]
    fn a_damaged_or_missing_bundle_is_never_copied() {
        let game = game_dir();
        let fake = game.parent().unwrap().join("fake.dll");
        fs::write(&fake, b"not the plugin").unwrap();

        for source in [fake.as_path(), Path::new("does/not/exist.dll")] {
            let error = install(source, Game::Ets2, &game, true).unwrap_err();
            assert_eq!(error.kind(), "bad_bundle");
        }
        assert_eq!(plugin_state(&game), PluginState::Missing);
        assert!(
            !plugins_dir(&game).exists(),
            "nothing is created for a bad bundle"
        );
        cleanup(&game);
    }

    #[test]
    fn failed_writes_are_explained_with_the_folder() {
        let folder = Path::new(
            "B:/Steam Library/steamapps/common/American Truck Simulator/bin/win_x64/plugins",
        );

        let denied = explain(
            &io::Error::from(io::ErrorKind::PermissionDenied),
            Game::Ats,
            folder,
        );
        assert_eq!(denied.kind(), "no_permission");
        assert!(denied.to_string().contains("Steam Library"), "{denied}");
        assert!(denied.to_string().contains("administrator"), "{denied}");

        let other = explain(&io::Error::other("disk full"), Game::Ats, folder);
        assert_eq!(other.kind(), "failed");
        assert!(other.to_string().contains("disk full"), "{other}");
        assert!(other.to_string().contains("Steam Library"), "{other}");
    }

    #[cfg(windows)]
    #[test]
    fn windows_file_in_use_errors_name_the_game() {
        let folder = Path::new(
            r"B:\SteamLibrary\steamapps\common\American Truck Simulator\bin\win_x64\plugins",
        );
        for code in [32, 33, 1224] {
            let error = explain(&io::Error::from_raw_os_error(code), Game::Ats, folder);
            assert_eq!(error.kind(), "in_use", "os error {code}");
            let message = error.to_string();
            assert!(
                message.contains("Close American Truck Simulator"),
                "{message}"
            );
            assert!(message.contains(r"bin\win_x64\plugins"), "{message}");
        }
    }

    /// Another program holds the file open without sharing it.
    #[cfg(windows)]
    #[test]
    fn a_locked_file_is_reported_and_left_alone() {
        use std::os::windows::fs::OpenOptionsExt;

        let game = game_dir();
        let target = put_other_plugin(&game);
        let lock = fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&target)
            .unwrap();

        // Locked against reading too, so Tacho can't tell whose file it is.
        assert_eq!(plugin_state(&game), PluginState::Unreadable);
        let unconfirmed = install(&shipped(), Game::Ets2, &game, false).unwrap_err();
        assert_eq!(unconfirmed.kind(), "needs_confirmation");
        let error = install(&shipped(), Game::Ets2, &game, true).unwrap_err();
        assert_eq!(error.kind(), "in_use", "{error}");
        assert!(
            error.to_string().contains("Close Euro Truck Simulator 2"),
            "{error}"
        );

        drop(lock);
        assert_eq!(fs::read(&target).unwrap(), b"another tool's build");
        install(&shipped(), Game::Ets2, &game, true).unwrap();
        cleanup(&game);
    }

    /// What really happens while the game runs: the DLL is mapped into a
    /// process as an image. Loads our own DLL as a resource image (no code in
    /// it runs) and tries to install over it.
    #[cfg(windows)]
    #[test]
    fn a_plugin_loaded_by_a_running_game_is_reported_as_in_use() {
        use std::ffi::c_void;
        use std::os::windows::ffi::OsStrExt;

        const LOAD_LIBRARY_AS_IMAGE_RESOURCE: u32 = 0x20;
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn LoadLibraryExW(name: *const u16, file: *mut c_void, flags: u32) -> *mut c_void;
            fn FreeLibrary(module: *mut c_void) -> i32;
        }

        let game = game_dir();
        install(&shipped(), Game::Ets2, &game, false).unwrap();
        let target = plugins_dir(&game).join(FILE_NAME);
        let wide: Vec<u16> = target.as_os_str().encode_wide().chain([0]).collect();
        // SAFETY: `wide` is a NUL-terminated path that outlives the call. The
        // flag maps the file without running its code or resolving imports.
        let module = unsafe {
            LoadLibraryExW(
                wide.as_ptr(),
                std::ptr::null_mut(),
                LOAD_LIBRARY_AS_IMAGE_RESOURCE,
            )
        };
        assert!(!module.is_null(), "{}", io::Error::last_os_error());

        // Reading still works, so the state is known while the game runs.
        assert_eq!(plugin_state(&game), PluginState::Ours);
        let error = install(&shipped(), Game::Ets2, &game, false).unwrap_err();
        assert_eq!(error.kind(), "in_use", "{error}");

        // SAFETY: `module` came from LoadLibraryExW above and is freed once.
        unsafe { FreeLibrary(module) };
        install(&shipped(), Game::Ets2, &game, false).unwrap();
        cleanup(&game);
    }

    /// Windows refuses the write itself (here: the name is taken by a folder).
    #[cfg(windows)]
    #[test]
    fn a_refused_write_is_reported_with_the_folder() {
        let game = game_dir();
        fs::create_dir_all(plugins_dir(&game).join(FILE_NAME)).unwrap();

        let error = install(&shipped(), Game::Ets2, &game, true).unwrap_err();
        assert_eq!(error.kind(), "no_permission", "{error}");
        assert!(
            error
                .to_string()
                .contains(&plugins_dir(&game).display().to_string()),
            "{error}"
        );
        cleanup(&game);
    }

    #[cfg(unix)]
    #[test]
    fn a_folder_without_write_access_is_reported() {
        use std::os::unix::fs::PermissionsExt;

        let game = game_dir();
        let bin = game.join("bin").join("win_x64");
        fs::set_permissions(&bin, fs::Permissions::from_mode(0o555)).unwrap();

        let result = install(&shipped(), Game::Ets2, &game, false);
        fs::set_permissions(&bin, fs::Permissions::from_mode(0o755)).unwrap();
        // Root ignores the mode and installs anyway.
        if let Err(error) = result {
            assert_eq!(error.kind(), "no_permission", "{error}");
            assert!(error.to_string().contains("win_x64"), "{error}");
        }
        cleanup(&game);
    }
}
