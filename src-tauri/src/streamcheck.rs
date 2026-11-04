//! A look at a stream before the player gets it (`polar_addon::probe`: follow
//! redirects, retry a link that isn't ready, spot placeholder clips). Each step
//! goes to the player's loading screen as a `player://probe` event; the events
//! name hosts only, never the rest of a link.

use polar_addon::probe::{self, ProbeEvent};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Serialize, Clone)]
struct Step<'a> {
    /// The player's id for this check, so it can ignore a previous one's late steps.
    id: u32,
    event: &'a ProbeEvent,
}

/// The URL the player should open, or why this source won't play.
/// With `id`, every step is reported to the webview.
pub async fn prepare(app: &AppHandle, url: &str, id: Option<u32>) -> Result<String, String> {
    probe::prepare(url, |event| {
        if let Some(id) = id {
            let _ = app.emit("player://probe", Step { id, event: &event });
        }
    })
    .await
}

/// The same check for the built-in (WebView) player; `mpv_load` runs it itself.
#[tauri::command]
pub async fn stream_probe(app: AppHandle, url: String, probe_id: Option<u32>) -> Result<String, String> {
    if !crate::player::is_web_url(&url) {
        return Ok(url);
    }
    prepare(&app, &url, probe_id).await
}
