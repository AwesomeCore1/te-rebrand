//! The tray icon: where Tacho lives while the driver plays.
//!
//! Left click opens the window. The menu has the same, one line that says
//! what the tracker is doing, and Quit, the only way to end the app.

use std::sync::Mutex;

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Wry};

use crate::shell;
use crate::tracking::Status;

pub struct Tray {
    icon: TrayIcon<Wry>,
    status: MenuItem<Wry>,
    /// The line on screen, so the menu is only touched when it changes.
    shown: Mutex<String>,
}

/// What the tracker is doing, in one line. The most useful thing wins.
pub fn status_line(status: &Status) -> String {
    if let Some(job) = &status.current_job {
        return format!("Tracking: {} to {}", job.source_city, job.destination_city);
    }
    if status.game_problem.is_some() {
        return "Can't read the game. Open Tacho for details".into();
    }
    match status.queued {
        0 => {}
        1 => return "1 job waiting to send".into(),
        n => return format!("{n} jobs waiting to send"),
    }
    if !status.linked {
        return "Not linked to an account".into();
    }
    match status.game {
        Some(te_telemetry::Game::Ets2) => "ETS2 is running, no job yet".into(),
        Some(te_telemetry::Game::Ats) => "ATS is running, no job yet".into(),
        None => "Waiting for the game".into(),
    }
}

/// Windows cuts tooltips off at 127 characters; stay well inside that.
fn tooltip(line: &str) -> String {
    let mut text = format!("Tacho: {line}");
    if text.chars().count() > 100 {
        text = text.chars().take(99).collect();
        text.push('…');
    }
    text
}

pub fn create(app: &AppHandle, status: &Status) -> tauri::Result<Tray> {
    let line = status_line(status);
    let open = MenuItem::with_id(app, "open", "Open Tacho", true, None::<&str>)?;
    // Greyed out: it is there to be read, not clicked.
    let status_item = MenuItem::with_id(app, "status", &line, false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Tacho", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &open,
            &PredefinedMenuItem::separator(app)?,
            &status_item,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let mut builder = TrayIconBuilder::with_id("tacho")
        .tooltip(tooltip(&line))
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "open" => shell::show(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                shell::show(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    Ok(Tray {
        icon: builder.build(app)?,
        status: status_item,
        shown: Mutex::new(line),
    })
}

impl Tray {
    /// Follows the tracker. Called on every status change, which is about
    /// once a second while driving, so an unchanged line costs nothing.
    pub fn update(&self, status: &Status) {
        let line = status_line(status);
        {
            let mut shown = self.shown.lock().unwrap_or_else(|e| e.into_inner());
            if *shown == line {
                return;
            }
            shown.clone_from(&line);
        }
        let _ = self.status.set_text(&line);
        let _ = self.icon.set_tooltip(Some(tooltip(&line)));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use te_telemetry::{Game, JobInfo};

    fn job() -> JobInfo {
        JobInfo {
            source_city: "Hamburg".into(),
            destination_city: "Lyon".into(),
            source_company: "Stokes".into(),
            destination_company: "Tradeaux".into(),
            cargo: "Yoghurt".into(),
            cargo_mass_kg: 14_000.0,
            planned_distance_km: 1_196.0,
            income: 21_840,
        }
    }

    #[test]
    fn the_status_line_follows_the_tracker() {
        let mut status = Status {
            linked: true,
            ..Status::default()
        };
        assert_eq!(status_line(&status), "Waiting for the game");

        status.game = Some(Game::Ets2);
        assert_eq!(status_line(&status), "ETS2 is running, no job yet");

        status.current_job = Some(job());
        assert_eq!(status_line(&status), "Tracking: Hamburg to Lyon");

        status.current_job = None;
        status.queued = 1;
        assert_eq!(status_line(&status), "1 job waiting to send");
        status.queued = 2;
        assert_eq!(status_line(&status), "2 jobs waiting to send");

        // A job on the road is worth more than the queue behind it.
        status.current_job = Some(job());
        assert_eq!(status_line(&status), "Tracking: Hamburg to Lyon");
    }

    #[test]
    fn the_status_line_says_when_something_needs_the_driver() {
        let mut status = Status::default();
        assert_eq!(status_line(&status), "Not linked to an account");

        status.queued = 3;
        assert_eq!(status_line(&status), "3 jobs waiting to send");

        status.game_problem = Some("The telemetry plugin in the game is revision 11".into());
        assert_eq!(
            status_line(&status),
            "Can't read the game. Open Tacho for details"
        );
    }

    #[test]
    fn long_tooltips_are_cut_to_fit_windows() {
        assert_eq!(
            tooltip("Waiting for the game"),
            "Tacho: Waiting for the game"
        );
        let long = tooltip(&format!("Tracking: {} to Lyon", "Llanfair".repeat(20)));
        assert_eq!(long.chars().count(), 100);
        assert!(long.ends_with('…'));
    }
}
