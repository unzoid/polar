//! The `mpv_*` commands the page calls: whether mpv can play here, load,
//! allow-listed commands and properties, picture/sound presets, stop, and a
//! snapshot of the frame for blurred overlays.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use polar_player::allow::{check_command, check_property, is_web_url};
use polar_player::crop::CROPDETECT;
use polar_player::tune::Tune;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State, WebviewWindow};

use super::autocrop::autocrop;
#[cfg(windows)]
use super::mpv_binary;
#[cfg(target_os = "macos")]
use super::mpv_library;
use crate::commands::CmdError;
use crate::locks::Locked;
use crate::AppState;

/// Whether mpv can be the player here: it must be installed and able to draw
/// into our window, which only Windows (`--wid`) and macOS (libmpv) can do so
/// far (see [`window_id`]). Elsewhere the player uses the webview's `<video>`.
#[tauri::command]
pub fn mpv_available() -> bool {
    #[cfg(target_os = "macos")]
    return mpv_library().is_some();
    #[cfg(windows)]
    return mpv_binary().is_some();
    #[cfg(not(any(windows, target_os = "macos")))]
    false
}

/// Load `url` (optionally starting at `start` seconds) and play. With `probe_id`,
/// the link check reports its steps as `player://probe` events. `headers` are
/// the stream's `behaviorHints.proxyHeaders.request`; only those
/// `polar_player::headers` passes reach the link check and mpv.
#[tauri::command]
pub async fn mpv_load(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    url: String,
    start: Option<f64>,
    probe_id: Option<u32>,
    headers: Option<std::collections::HashMap<String, String>>,
) -> Result<(), CmdError> {
    // Web streams, or a finished download - never any other path on disk.
    let downloaded = app.state::<Arc<crate::downloads::Downloads>>().owns(&url);
    if !is_web_url(&url) && !downloaded {
        return Err(CmdError::Unsupported("only http(s) streams and downloads can be played".into()));
    }
    // A link that's not ready yet, or a placeholder clip in place of the video.
    let headers =
        if downloaded { Vec::new() } else { polar_player::headers::playback_headers(&headers.unwrap_or_default()) };
    let url = if downloaded { url } else { crate::streamcheck::prepare(&app, &url, headers.clone(), probe_id).await? };
    state.mpv.touch();
    state.mpv.ensure(&app, &window).await.map_err(CmdError::Player)?;
    let mut options = String::new();
    if let Some(s) = start.filter(|s| *s > 1.0) {
        options = format!("start={s:.2}");
    }
    // A new file is measured afresh (autocrop): drop the last one's crop.
    state.mpv.loads.fetch_add(1, Ordering::SeqCst);
    state.mpv.request(json!(["set_property", "video-zoom", 0])).await.ok();
    // The add-on's headers for this source, or none left over from the last one.
    let fields = polar_player::headers::mpv_fields(&headers);
    state.mpv.request(json!(["set_property", "http-header-fields", fields])).await.map_err(CmdError::Player)?;
    state.mpv.request(json!(["loadfile", url, "replace", -1, options])).await.map_err(CmdError::Player)?;
    state.mpv.request(json!(["set_property", "pause", false])).await.map_err(CmdError::Player)?;
    state.mpv.set_visible(true).await;
    Ok(())
}

/// An allow-listed mpv command, e.g. `["seek", 10, "relative"]`.
#[tauri::command]
pub async fn mpv_command(state: State<'_, AppState>, args: Vec<Value>) -> Result<Value, String> {
    check_command(&args)?;
    state.mpv.request(Value::Array(args)).await
}

#[tauri::command]
pub async fn mpv_set(state: State<'_, AppState>, name: String, value: Value) -> Result<(), String> {
    check_property(&name)?;
    state.mpv.request(json!(["set_property", name, value])).await.map(|_| ())
}

/// Apply [`Tune`] to the running mpv. Takes effect immediately (audio
/// filters, decoding, debanding) or from the next read-ahead (cache).
#[tauri::command]
pub async fn mpv_tune(app: AppHandle, state: State<'_, AppState>, tune: Tune) -> Result<(), String> {
    if state.mpv.conn.lock().await.is_none() {
        return Ok(());
    }
    let mpv = &state.mpv;
    let was = *mpv.tuned.locked();
    if was == tune {
        return Ok(());
    }
    if was.audio_filters() != tune.audio_filters() {
        mpv.request(json!(["set_property", "af", tune.audio_filters()])).await?;
    }
    if was.hwdec_mode() != tune.hwdec_mode() {
        mpv.request(json!(["set_property", "hwdec", tune.hwdec_mode()])).await?;
    }
    if was.autocrop != tune.autocrop {
        if tune.autocrop {
            mpv.request(json!(["vf", "add", CROPDETECT])).await?;
        } else {
            mpv.request(json!(["vf", "remove", "@autocrop"])).await?;
            mpv.request(json!(["set_property", "video-zoom", 0])).await?;
        }
        // Dialogue placed and sized by the window rather than the (zoomed)
        // picture, so cropping never moves, grows or stretches it. See
        // [`zoom_for`]. Positioned signs still follow the picture.
        mpv.request(json!(["set_property", "sub-ass-force-margins", tune.autocrop])).await?;
        mpv.request(json!(["set_property", "sub-ass-scale-with-window", tune.autocrop])).await?;
    }
    if was.deband != tune.deband {
        mpv.request(json!(["set_property", "deband", tune.deband])).await?;
    }
    if was.buffer != tune.buffer {
        let (secs, bytes) = tune.cache();
        mpv.request(json!(["set_property", "cache-secs", secs])).await?;
        mpv.request(json!(["set_property", "demuxer-max-bytes", bytes])).await?;
    }
    *mpv.tuned.locked() = tune;
    if tune.autocrop && !was.autocrop {
        let run = mpv.autocrop_run.fetch_add(1, Ordering::SeqCst) + 1;
        tauri::async_runtime::spawn(autocrop(app, run));
    }
    Ok(())
}

/// Stop playback but keep mpv alive (idle) for the next title.
#[tauri::command]
pub async fn mpv_stop(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    if state.mpv.conn.lock().await.is_none() {
        return Ok(());
    }
    state.mpv.schedule_idle_shutdown(&app);
    state.mpv.set_visible(false).await;
    state.mpv.request(json!(["stop"])).await.map(|_| ())
}

/// The current frame as a JPEG data URL — mpv's picture lives in a native
/// window the page can't sample, so overlays blur this snapshot instead.
#[tauri::command]
pub async fn mpv_snapshot(state: State<'_, AppState>) -> Result<String, String> {
    // A file of its own per call: two snapshots at once never read each other's half-written frame.
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let path = super::shots_dir().join(format!("frame-{}.jpg", NEXT.fetch_add(1, Ordering::Relaxed)));
    let path_str = path.to_string_lossy().to_string();
    state.mpv.request(json!(["screenshot-to-file", path_str, "video"])).await?;
    let read = tokio::fs::read(&path).await;
    let _ = tokio::fs::remove_file(&path).await;
    let bytes = read.map_err(|e| e.to_string())?;
    use base64::Engine as _;
    Ok(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}
