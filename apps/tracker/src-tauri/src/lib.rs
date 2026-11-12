mod api;
mod store;
mod tracking;

use std::sync::Arc;
use std::time::Duration;

use tauri::{Emitter, Manager, State};
use te_telemetry::units;

use crate::tracking::{PairingStatus, Status, Tracker};

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
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let store = store::Store::new(app.path().app_data_dir()?)?;
            let handle = app.handle().clone();
            let notify = Box::new(move |status: Status| {
                let _ = handle.emit("status", status);
            });
            let tracker = Tracker::new(notify, api::Api::new(api::base_url()), store);
            app.manage(tracker.clone());

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
        .invoke_handler(tauri::generate_handler![
            km_to_miles,
            get_status,
            start_link,
            cancel_link,
            unlink,
            retry_uploads,
            start_replay
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
