//! The `mpv_*` commands the page calls: whether mpv can play here, load,
//! allow-listed commands and properties, picture/sound presets, stop, and a
//! snapshot of the frame for blurred overlays.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use polar_player::allow::{check_command, check_property, is_web_url};
use polar_player::crop::{zoom_for, CROPDETECT};
use polar_player::tune::Tune;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager, State, WebviewWindow};

use super::autocrop::autocrop;
#[cfg(windows)]
use super::mpv_binary;
#[cfg(mpv_apple)]
use super::mpv_library;
use super::preroll::{opening, Opening};
use crate::commands::CmdError;
use crate::locks::Locked;
use crate::AppState;

/// Whether mpv can be the player here: it must be installed and able to draw
/// into our window, which only Windows (`--wid`), macOS, iOS and Android (libmpv
/// in the app) can do so far (see [`window_id`]). Elsewhere the player uses the
/// webview's `<video>`.
#[tauri::command]
pub fn mpv_available() -> bool {
    #[cfg(mpv_apple)]
    return mpv_library().is_some();
    #[cfg(windows)]
    return mpv_binary().is_some();
    #[cfg(target_os = "android")]
    return super::android::available();
    #[cfg(not(any(windows, mpv_in_app)))]
    false
}

/// Hide the system's bars while the player is open, and show them again when it closes. On
/// iPhones and iPads: the status bar, and the home indicator until the screen is touched
/// (ios/system_bars.m). Elsewhere nothing changes.
#[tauri::command]
pub fn player_system_bars(hidden: bool) {
    #[cfg(target_os = "ios")]
    {
        extern "C" {
            fn polar_set_system_bars_hidden(hide: std::ffi::c_int);
        }
        unsafe { polar_set_system_bars_hidden(hidden.into()) }
    }
    #[cfg(not(target_os = "ios"))]
    let _ = hidden;
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
    // Ours as they are: a download, or the torrent engine's loopback link.
    let local = downloaded || crate::torrent::owns(&app, &url);
    // A link that's not ready yet, or a placeholder clip in place of the video.
    let headers =
        if local { Vec::new() } else { polar_player::headers::playback_headers(&headers.unwrap_or_default()) };
    let url = if local { url } else { crate::streamcheck::prepare(&app, &url, headers.clone(), probe_id).await? };
    state.mpv.touch();
    state.mpv.ensure(&app, &window).await.map_err(CmdError::Player)?;
    let mut options = String::new();
    if let Some(s) = start.filter(|s| *s > 1.0) {
        options = format!("start={s:.2}");
    }
    // A new file is measured afresh (autocrop): drop the last one's crop.
    let load = state.mpv.loads.fetch_add(1, Ordering::SeqCst) + 1;
    state.mpv.playhead.store(f64::NAN.to_bits(), Ordering::SeqCst);
    state.mpv.request(json!(["set_property", "video-zoom", 0])).await.ok();
    // The add-on's headers for this source, or none left over from the last one.
    let fields = polar_player::headers::mpv_fields(&headers);
    *state.mpv.source.locked() = Some((load, url.clone(), fields.clone()));
    // Autocrop: probe the opening while this load buffers, and start paused
    // until the probe is done or out of time (docs/autocrop.md §3).
    let probe = state.mpv.tuned.locked().autocrop.then(|| {
        *state.mpv.opening.locked() = Some(Opening::Probing(load));
        tauri::async_runtime::spawn(opening(url.clone(), fields.clone(), start.unwrap_or(0.0)))
    });
    let loaded = load_paused(&state, &url, fields, &options, probe.is_some()).await;
    let found = match probe {
        Some(task) if loaded.is_ok() => task.await.ok().flatten(),
        // The probe stops by itself once its wait is over.
        _ => None,
    };
    if let Some(f) = found {
        if let Ok(osd) = state.mpv.request(json!(["get_property", "osd-dimensions"])).await {
            let int = |k: &str| osd.get(k).and_then(Value::as_i64).filter(|n| *n > 0);
            if let (Some(w), Some(h)) = (int("w"), int("h")) {
                let zoom = zoom_for(f.bars, f.full, f.display, (w, h));
                state.mpv.request(json!(["set_property", "video-zoom", zoom])).await.ok();
            }
        }
    }
    {
        let mut slot = state.mpv.opening.locked();
        if matches!(*slot, Some(Opening::Probing(l)) if l == load) {
            *slot = found.map(|f| Opening::Ready { load, full: f.full, bars: f.bars });
        }
    }
    loaded?;
    state.mpv.request(json!(["set_property", "pause", false])).await.map_err(CmdError::Player)?;
    state.mpv.set_visible(true).await;
    Ok(())
}

/// Send the headers and load `url`, paused if `paused` (else playing from
/// the next `pause` change on).
async fn load_paused(
    state: &AppState,
    url: &str,
    fields: Vec<String>,
    options: &str,
    paused: bool,
) -> Result<(), CmdError> {
    state.mpv.request(json!(["set_property", "http-header-fields", fields])).await.map_err(CmdError::Player)?;
    if paused {
        state.mpv.request(json!(["set_property", "pause", true])).await.map_err(CmdError::Player)?;
    }
    state.mpv.request(json!(["loadfile", url, "replace", -1, options])).await.map_err(CmdError::Player)?;
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
        #[cfg(target_os = "android")]
        let mode = tune.android_hwdec();
        #[cfg(not(target_os = "android"))]
        let mode = tune.hwdec_mode();
        mpv.request(json!(["set_property", "hwdec", mode])).await?;
    }
    // cropdetect runs unless our detector reads every frame (Tune::cropdetect).
    if was.cropdetect() != tune.cropdetect() {
        if tune.cropdetect() {
            mpv.request(json!(["vf", "add", CROPDETECT])).await?;
        } else {
            mpv.request(json!(["vf", "remove", "@autocrop"])).await?;
        }
    }
    if was.autocrop != tune.autocrop {
        if !tune.autocrop {
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
