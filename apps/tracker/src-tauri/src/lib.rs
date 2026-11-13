mod api;
mod autostart;
mod games;
mod plugin;
mod shell;
mod store;
mod tracking;
mod tray;

use std::sync::Arc;
use std::time::Duration;

use serde::Serialize;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use te_telemetry::{Game, units};

use crate::plugin::{GamesReport, InstallError};
use crate::shell::Shell;
use crate::tracking::{PairingStatus, Status, Tracker};
use crate::tray::Tray;

type TrackerState<'a> = State<'a, Arc<Tracker>>;

/// Converts km to miles for the UI. Distances are stored in km everywhere.
#[tauri::command]
fn km_to_miles(km: f64) -> f64 {
    units::km_to_miles(km)
}

#[tauri::command]
async fn get_status(tracker: TrackerState<'_>) -> Result<Status, String> {
    Ok(tracker.status().await)
}

/// "Link account": shows a code and opens the website to approve it.
#[tauri::command]
async fn start_link(tracker: TrackerState<'_>) -> Result<PairingStatus, String> {
    let pairing = tracker
        .inner()
        .clone()
        .start_link()
        .await
        .map_err(|e| e.to_string())?;
    // If the browser can't be opened, the UI still shows the code and a link.
    let _ = tauri_plugin_opener::open_url(&pairing.verification_url, None::<&str>);
    Ok(pairing)
}

#[tauri::command]
async fn cancel_link(tracker: TrackerState<'_>) -> Result<(), String> {
    tracker.cancel_link().await;
    Ok(())
}

#[tauri::command]
async fn unlink(tracker: TrackerState<'_>) -> Result<(), String> {
    tracker.unlink().await;
    Ok(())
}

#[tauri::command]
async fn retry_uploads(tracker: TrackerState<'_>) -> Result<(), String> {
    tracker.inner().clone().flush().await;
    Ok(())
}

/// Which games are installed and whether each has the telemetry plugin.
#[tauri::command]
async fn get_games() -> Result<GamesReport, String> {
    tauri::async_runtime::spawn_blocking(plugin::report)
        .await
        .map_err(|e| e.to_string())
}

/// Copies the shipped plugin into one game's folder. Only ever called from a
/// click. `replace` is set after the driver agreed to overwrite another
/// tool's file.
#[tauri::command]
async fn install_plugin(
    app: AppHandle,
    game: Game,
    replace: bool,
) -> Result<GamesReport, InstallError> {
    let source = app
        .path()
        .resolve(plugin::RESOURCE, BaseDirectory::Resource)
        .map_err(|_| InstallError::BadBundle)?;
    tauri::async_runtime::spawn_blocking(move || {
        plugin::install_for(&source, game, replace)?;
        Ok(plugin::report())
    })
    .await
    .unwrap_or_else(|e| {
        Err(InstallError::Failed {
            folder: "the game's folder".into(),
            reason: e.to_string(),
        })
    })
}

/// The choices on the Settings view that belong to this PC.
#[derive(Debug, Clone, Copy, Serialize)]
struct AppSettings {
    /// `false` where Tacho can't register itself at login (not Windows).
    start_at_login_supported: bool,
    start_at_login: bool,
}

fn app_settings() -> AppSettings {
    AppSettings {
        start_at_login_supported: autostart::SUPPORTED,
        start_at_login: autostart::is_enabled(),
    }
}

#[tauri::command]
fn get_settings() -> AppSettings {
    app_settings()
}

/// "Start with Windows". Off until the driver turns it on.
#[tauri::command]
fn set_start_at_login(enabled: bool) -> Result<AppSettings, String> {
    autostart::set_enabled(enabled)
        .map_err(|e| format!("Couldn't change what starts with Windows: {e}"))?;
    Ok(app_settings())
}

/// Dev only: plays the recorded Hamburg to Lyon drive through the real
/// pipeline (job detection, queue, upload), so a job can be saved end to end
/// without the game. The recording squeezes about an hour into 5 s, so its
/// timestamps are stretched 1000x to look like a real drive to the API.
#[cfg(debug_assertions)]
#[tauri::command]
async fn start_replay(tracker: TrackerState<'_>) -> Result<(), String> {
    use te_telemetry::{replay, source::ReplaySource};
    let frames = replay::parse(include_str!(
        "../../../../crates/telemetry/tests/fixtures/hamburg-lyon.jsonl"
    ))
    .map_err(|e| e.to_string())?;
    let last = frames.last().map(|f| f.t_ms).unwrap_or(0);
    let source = Box::new(ReplaySource::new(frames));
    let clock = tracking::Clock::replay(last, 1000);
    tauri::async_runtime::spawn(tracker.inner().clone().run_source(
        source,
        clock,
        Duration::from_millis(400),
    ));
    Ok(())
}

#[cfg(not(debug_assertions))]
#[tauri::command]
async fn start_replay() -> Result<(), String> {
    Err("Replays are only available in development builds.".into())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // First, so a second start hands over to the running Tacho before
        // anything else is set up. Windows starting it at login must not pop
        // the window open.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !autostart::has_flag(&args) {
                shell::show(app);
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let store = store::Store::new(app.path().app_data_dir()?)?;
            app.manage(Shell::new(store.clone()));

            let handle = app.handle().clone();
            let notify = Box::new(move |status: Status| {
                if let Some(tray) = handle.try_state::<Tray>() {
                    tray.update(&status);
                }
                // With the window in the tray nobody is looking; `shell::show`
                // sends the current status when it comes back.
                if handle.state::<Shell>().window_shown() {
                    let _ = handle.emit("status", status);
                }
            });
            let tracker = Tracker::new(notify, api::Api::new(api::base_url()), store);
            app.manage(tracker.clone());

            let status = tauri::async_runtime::block_on(tracker.status());
            app.manage(tray::create(app.handle(), &status)?);

            // Started by Windows at login: stay in the tray.
            if !autostart::started_at_login() {
                shell::show(app.handle());
            }

            // Send anything left over from last time, then keep retrying.
            let flusher = tracker.clone();
            tauri::async_runtime::spawn(async move {
                loop {
                    flusher.clone().flush().await;
                    tokio::time::sleep(tracking::FLUSH_EVERY).await;
                }
            });

            // The game: shared memory from the RenCloud plugin (Windows only).
            #[cfg(windows)]
            tauri::async_runtime::spawn(tracker.clone().run_source(
                Box::new(te_telemetry::source::SharedMemorySource::new()),
                tracking::Clock::live(),
                Duration::from_millis(250),
            ));

            Ok(())
        })
        .on_window_event(|window, event| {
            // Closing the window keeps Tacho tracking from the tray.
            if let WindowEvent::CloseRequested { api, .. } = event
                && window.label() == shell::WINDOW
            {
                api.prevent_close();
                shell::close_requested(window.app_handle());
            }
        })
        .invoke_handler(tauri::generate_handler![
            km_to_miles,
            get_status,
            start_link,
            cancel_link,
            unlink,
            retry_uploads,
            get_games,
            install_plugin,
            get_settings,
            set_start_at_login,
            shell::hide_to_tray,
            shell::keep_open,
            shell::quit,
            start_replay
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, _event| {
            // macOS: clicking the Dock icon brings the window back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                shell::show(_app);
            }
        });
}
