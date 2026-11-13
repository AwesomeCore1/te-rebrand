//! The window's life in the tray: shown on demand, hidden instead of closed.
//!
//! Closing the window keeps Tacho tracking. The first time, the window stays
//! and says so (the driver must not think the app is gone); after that it
//! just hides. Only Quit ends the app.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager};

use crate::store::{Prefs, Store};
use crate::tracking::Tracker;

pub const WINDOW: &str = "main";

/// Sent to the window the first time it is closed. It answers with
/// `hide_to_tray`, `keep_open` or `quit`.
pub const TRAY_NOTICE_EVENT: &str = "tray-notice";

pub struct Shell {
    store: Store,
    window_shown: AtomicBool,
    notice_seen: AtomicBool,
    /// The window is showing the notice and waiting for an answer.
    notice_pending: AtomicBool,
}

#[derive(Debug, PartialEq, Eq)]
enum CloseAction {
    Hide,
    /// Keep the window and say where Tacho goes.
    Explain,
}

impl Shell {
    pub fn new(store: Store) -> Self {
        let prefs = store.load_prefs();
        Self {
            store,
            window_shown: AtomicBool::new(false),
            notice_seen: AtomicBool::new(prefs.tray_notice_seen),
            notice_pending: AtomicBool::new(false),
        }
    }

    /// Whether the window is on screen. Status updates are only sent to it
    /// while it is: with the window in the tray, only the Rust side works.
    pub fn window_shown(&self) -> bool {
        self.window_shown.load(Ordering::Relaxed)
    }

    /// What to do when the driver closes the window.
    fn on_close(&self) -> CloseAction {
        if self.notice_seen.load(Ordering::Relaxed) {
            return CloseAction::Hide;
        }
        if self.notice_pending.swap(true, Ordering::Relaxed) {
            // Closed again with the notice on screen: that is an answer too.
            self.notice_read();
            return CloseAction::Hide;
        }
        CloseAction::Explain
    }

    fn notice_read(&self) {
        self.notice_pending.store(false, Ordering::Relaxed);
        if !self.notice_seen.swap(true, Ordering::Relaxed) {
            // If this can't be saved, the notice shows once more after a restart.
            let _ = self.store.save_prefs(&Prefs {
                tray_notice_seen: true,
            });
        }
    }

    fn notice_dismissed(&self) {
        self.notice_pending.store(false, Ordering::Relaxed);
    }
}

/// Shows the window, or brings it to the front when it is already open.
pub fn show(app: &AppHandle) {
    let Some(window) = app.get_webview_window(WINDOW) else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
    app.state::<Shell>()
        .window_shown
        .store(true, Ordering::Relaxed);

    // The window got no updates while it was hidden: bring it up to date.
    let tracker = app.state::<Arc<Tracker>>().inner().clone();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = app.emit("status", tracker.status().await);
    });
}

fn hide(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(WINDOW) {
        let _ = window.hide();
    }
    app.state::<Shell>()
        .window_shown
        .store(false, Ordering::Relaxed);
}

/// The driver closed the window (the X, Alt+F4).
pub fn close_requested(app: &AppHandle) {
    let shell = app.state::<Shell>();
    match shell.on_close() {
        CloseAction::Hide => hide(app),
        CloseAction::Explain => {
            if app.emit_to(WINDOW, TRAY_NOTICE_EVENT, ()).is_err() {
                shell.notice_read();
                hide(app);
            }
        }
    }
}

/// The driver read the notice: go to the tray, and don't explain again.
#[tauri::command]
pub fn hide_to_tray(app: AppHandle) {
    app.state::<Shell>().notice_read();
    hide(&app);
}

/// The driver dismissed the notice without choosing: the window stays, and
/// the next close explains again.
#[tauri::command]
pub fn keep_open(app: AppHandle) {
    app.state::<Shell>().notice_dismissed();
}

#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_store() -> (Store, std::path::PathBuf) {
        let dir = std::env::temp_dir().join(format!("tacho-shell-{}", uuid::Uuid::new_v4()));
        (Store::new(dir.clone()).unwrap(), dir)
    }

    #[test]
    fn the_first_close_explains_and_later_ones_hide() {
        let (store, dir) = temp_store();
        let shell = Shell::new(store.clone());
        assert_eq!(shell.on_close(), CloseAction::Explain);
        shell.notice_read(); // "Close to tray" in the window
        assert_eq!(shell.on_close(), CloseAction::Hide);

        // Remembered across restarts: told once, not once per start.
        let restarted = Shell::new(store);
        assert_eq!(restarted.on_close(), CloseAction::Hide);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn closing_twice_hides_even_if_the_notice_was_never_answered() {
        let (store, dir) = temp_store();
        let shell = Shell::new(store.clone());
        assert_eq!(shell.on_close(), CloseAction::Explain);
        assert_eq!(shell.on_close(), CloseAction::Hide);
        assert!(store.load_prefs().tray_notice_seen);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_dismissed_notice_is_shown_again_on_the_next_close() {
        let (store, dir) = temp_store();
        let shell = Shell::new(store.clone());
        assert_eq!(shell.on_close(), CloseAction::Explain);
        shell.notice_dismissed();
        assert_eq!(shell.on_close(), CloseAction::Explain);
        assert!(!store.load_prefs().tray_notice_seen);
        std::fs::remove_dir_all(dir).unwrap();
    }
}
