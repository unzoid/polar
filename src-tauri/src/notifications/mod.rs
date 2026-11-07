//! The system's notifications (#209) for every platform but Android, behind the commands
//! src/lib/platform/notifications.ts calls: Linux through the desktop's notification service
//! (D-Bus), Windows as toasts, macOS and iOS through UserNotifications (src/apple/notes.m).
//! Android's are in the activity (MainActivity.kt, NotesWorker.kt) and never come here.
//!
//! The web side decides what to say; this only shows it and reports clicks as a
//! `notification://click` event carrying the note's payload, which the web side checks before
//! acting on. A click that started the app waits for `notifications_take_launch`.

// Android answers from the activity instead: these commands are there but never called.
#![cfg_attr(target_os = "android", allow(dead_code))]

use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager};

#[cfg(any(target_os = "macos", target_os = "ios"))]
mod apple;
#[cfg(target_os = "linux")]
mod linux;
#[cfg(windows)]
mod toasts;

#[cfg(any(target_os = "macos", target_os = "ios"))]
use apple as system;
#[cfg(target_os = "linux")]
use linux as system;
#[cfg(windows)]
use toasts as system;

#[derive(Debug, Clone, Deserialize)]
pub struct Note {
    pub id: String,
    pub title: String,
    pub body: String,
    pub payload: String,
}

/// Read only where the system plans (iOS).
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(not(target_os = "ios"), allow(dead_code))]
pub struct PlannedNote {
    pub id: String,
    pub title: String,
    pub body: String,
    pub payload: String,
    /// Milliseconds since 1970.
    pub at: i64,
}

/// "granted", "denied" or "prompt" (not asked yet).
pub type Permission = &'static str;

/// Longest title and body handed to the system: names come from metadata.
const MAX_TEXT: usize = 300;
/// Most notes planned at once (iOS keeps 64 pending per app).
pub const MAX_PLANNED: usize = 60;

static APP: OnceLock<AppHandle> = OnceLock::new();
static LAUNCH: Mutex<Option<String>> = Mutex::new(None);
/// The web side has asked for the launch click, so it hears the event from then on.
static LISTENING: AtomicBool = AtomicBool::new(false);

pub(crate) fn clip(text: &str) -> String {
    let text: String = text.chars().filter(|c| !c.is_control()).collect();
    match text.char_indices().nth(MAX_TEXT) {
        Some((at, _)) => format!("{}…", &text[..at]),
        None => text,
    }
}

/// Starts listening for clicks; called once at startup.
pub fn manage(app: &AppHandle) {
    let _ = APP.set(app.clone());
    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "linux", windows))]
    system::start();
}

/// A note was clicked: bring the window forward and tell the web side, or keep it for
/// `notifications_take_launch` if the web side isn't listening yet.
pub(crate) fn clicked(payload: String) {
    let Some(app) = APP.get() else {
        *LAUNCH.lock().unwrap_or_else(|e| e.into_inner()) = Some(payload);
        return;
    };
    #[cfg(desktop)]
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
    #[cfg(mobile)]
    let _ = app.get_webview_window("main");
    // A click that starts the app arrives before the page listens: kept until it asks.
    if !LISTENING.load(Ordering::SeqCst) {
        *LAUNCH.lock().unwrap_or_else(|e| e.into_inner()) = Some(payload.clone());
    }
    if let Err(e) = app.emit("notification://click", payload) {
        tracing::warn!("notification click: {e}");
    }
}

#[tauri::command]
pub async fn notifications_permission() -> Permission {
    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "linux", windows))]
    return system::permission().await;
    #[allow(unreachable_code)]
    "denied"
}

#[tauri::command]
pub async fn notifications_request() -> Permission {
    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "linux", windows))]
    return system::request().await;
    #[allow(unreachable_code)]
    "denied"
}

#[tauri::command]
pub async fn notifications_show(note: Note) -> Result<(), String> {
    let note = Note { title: clip(&note.title), body: clip(&note.body), ..note };
    #[cfg(any(target_os = "macos", target_os = "ios", target_os = "linux", windows))]
    return system::show(note).await;
    #[allow(unreachable_code)]
    {
        let _ = note;
        Ok(())
    }
}

/// Replaces every planned note. Only iOS plans (desktops show notes while running; Android
/// plans in the activity).
#[tauri::command]
pub async fn notifications_plan(notes: Vec<PlannedNote>) -> Result<(), String> {
    let notes: Vec<PlannedNote> = notes
        .into_iter()
        .take(MAX_PLANNED)
        .map(|n| PlannedNote { title: clip(&n.title), body: clip(&n.body), ..n })
        .collect();
    #[cfg(target_os = "ios")]
    return apple::plan(notes).await;
    #[allow(unreachable_code)]
    {
        let _ = notes;
        Ok(())
    }
}

/// The payload of the click that started the app, once.
#[tauri::command]
pub fn notifications_take_launch() -> Option<String> {
    LISTENING.store(true, Ordering::SeqCst);
    LAUNCH.lock().unwrap_or_else(|e| e.into_inner()).take()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_or_odd_text_is_clipped() {
        assert_eq!(clip("S1 E2 is out"), "S1 E2 is out");
        assert_eq!(clip("a\u{0}b\nc"), "abc");
        let long = "é".repeat(400);
        assert_eq!(clip(&long).chars().count(), MAX_TEXT + 1);
    }
}
