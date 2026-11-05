//! A look at a stream before the player gets it (`polar_addon::probe`: follow
//! redirects, retry a link that isn't ready, spot placeholder clips). Each step
//! goes to the player's loading screen as a `player://probe` event; the events
//! name hosts only, never the rest of a link.

use std::collections::HashMap;

use polar_addon::probe::{self, ProbeEvent};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::commands::CmdError;

#[derive(Serialize, Clone)]
struct Step<'a> {
    /// The player's id for this check, so it can ignore a previous one's late steps.
    id: u32,
    event: &'a ProbeEvent,
}

/// The URL the player should open, or why this source won't play.
/// With `id`, every step is reported to the webview. `headers` are the ones
/// the player sends (`polar_player::headers::playback_headers`).
pub async fn prepare(
    app: &AppHandle,
    url: &str,
    headers: Vec<(String, String)>,
    id: Option<u32>,
) -> Result<String, CmdError> {
    probe::prepare(url, headers, |event| {
        if let Some(id) = id {
            let _ = app.emit("player://probe", Step { id, event: &event });
        }
    })
    .await
    .map_err(CmdError::Source)
}

/// The same check for the built-in (WebView) player; `mpv_load` runs it itself.
#[tauri::command]
/// `<video>` can't send the add-on's headers itself, so a source that needs them
/// passes here and may still be refused when the page opens it.
pub async fn stream_probe(
    app: AppHandle,
    url: String,
    probe_id: Option<u32>,
    headers: Option<HashMap<String, String>>,
) -> Result<String, CmdError> {
    if !polar_player::allow::is_web_url(&url) {
        return Ok(url);
    }
    let headers = polar_player::headers::playback_headers(&headers.unwrap_or_default());
    prepare(&app, &url, headers, probe_id).await
}
