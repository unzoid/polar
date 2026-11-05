//! Autocrop: zooming past the black bars cropdetect finds, frame by frame
//! (the rules are `polar_player::crop`; this is the mpv side).

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use polar_player::crop::{cropdetect_for, cropdetect_reading, zoom_changed, zoom_for, CropTracker, Rect, CROPDETECT};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::sync::mpsc;

use super::Mpv;
use crate::locks::Locked;
use crate::AppState;

/// Property-change ids from here up are autocrop's own observations: the
/// reader hands them to the running [`autocrop`] task instead of the UI.
pub(super) const CROP_OBSERVE_BASE: u64 = 1 << 32;

/// What [`autocrop`] needs to know about the video and the window.
#[derive(Debug, Clone, Copy)]
struct CropGeometry {
    /// Frame size in video pixels, and as displayed (non-square pixels).
    size: (i64, i64),
    display: (i64, i64),
    window: (i64, i64),
    /// The cropdetect filter this video needs ([`cropdetect_for`]).
    filter: &'static str,
}

async fn crop_geometry(mpv: &Mpv) -> Option<CropGeometry> {
    let params = mpv.request(json!(["get_property", "video-params"])).await.ok()?;
    let osd = mpv.request(json!(["get_property", "osd-dimensions"])).await.ok()?;
    let int = |v: &Value, k: &str| v.get(k).and_then(Value::as_i64).filter(|n| *n > 0);
    Some(CropGeometry {
        size: (int(&params, "w")?, int(&params, "h")?),
        display: (int(&params, "dw")?, int(&params, "dh")?),
        window: (int(&osd, "w")?, int(&osd, "h")?),
        filter: cropdetect_for(params.get("gamma").and_then(Value::as_str)),
    })
}

/// While autocrop is on: mpv reports cropdetect's reading whenever it
/// changes, and the playback position once per displayed frame, observed in
/// that order so each frame's reading arrives before its tick. Every frame
/// goes to [`CropTracker`] and the zoom follows at once. Readings run a
/// frame ahead of the screen (mpv filters a frame before showing it), so a
/// switch the tracker believes straight away lands on the cut. While paused
/// no frames come and nothing changes, except keeping the zoom right for
/// the window.
pub(super) async fn autocrop(app: AppHandle, run: u64) {
    let meta_id = CROP_OBSERVE_BASE + run * 2;
    let frame_id = meta_id + 1;
    let (tx, mut rx) = mpsc::unbounded_channel();
    {
        let state = app.state::<AppState>();
        *state.mpv.crop_events.locked() = Some((run, tx));
        let _ = state.mpv.request(json!(["observe_property", meta_id, "vf-metadata/autocrop"])).await;
        let _ = state.mpv.request(json!(["observe_property", frame_id, "time-pos"])).await;
    }
    let mut tracker = CropTracker::default();
    let mut reading: Option<Rect> = None;
    let mut geometry: Option<(CropGeometry, Instant)> = None;
    let mut sent: Option<(u64, f64)> = None; // (load, video-zoom) last set on mpv
    let mut filter = CROPDETECT; // what mpv_tune added
    loop {
        let event = tokio::time::timeout(Duration::from_millis(500), rx.recv()).await;
        let state = app.state::<AppState>();
        let mpv = &state.mpv;
        if !mpv.tuned.locked().autocrop || mpv.autocrop_run.load(Ordering::SeqCst) != run {
            break;
        }
        let frame = match event {
            Ok(None) => break, // a newer run took over
            Ok(Some((id, data))) if id == meta_id => {
                reading = cropdetect_reading(&data);
                continue;
            }
            Ok(Some((id, data))) if id == frame_id => data.is_number(),
            Ok(Some(_)) => continue,
            Err(_) => false, // nothing for 500 ms: paused
        };
        let load = mpv.loads.load(Ordering::SeqCst);
        // The window changes size (fullscreen) and the video rarely does:
        // re-read them 4 times a second, and on every idle tick.
        if !frame || geometry.is_none_or(|(_, at)| at.elapsed() >= Duration::from_millis(250)) {
            geometry = crop_geometry(mpv).await.map(|g| (g, Instant::now()));
        }
        let Some((g, _)) = geometry else {
            continue; // between files: nothing to measure
        };
        // HDR and SDR need different thresholds: swap the filter when the video's changes.
        if g.filter != filter {
            if !mpv.tuned.locked().autocrop {
                break;
            }
            mpv.request(json!(["vf", "remove", "@autocrop"])).await.ok();
            if mpv.request(json!(["vf", "add", g.filter])).await.is_ok() {
                filter = g.filter;
                reading = None;
            }
            continue;
        }
        if frame {
            tracker.update(load, g.size, g.display, reading);
        }
        let zoom = zoom_for(tracker.bars(load), g.size, g.display, g.window);
        if zoom_changed(sent, load, zoom) && mpv.request(json!(["set_property", "video-zoom", zoom])).await.is_ok() {
            sent = Some((load, zoom));
        }
    }
    let state = app.state::<AppState>();
    {
        let mut slot = state.mpv.crop_events.locked();
        if slot.as_ref().is_some_and(|(r, _)| *r == run) {
            *slot = None;
        }
    }
    let _ = state.mpv.request(json!(["unobserve_property", meta_id])).await;
    let _ = state.mpv.request(json!(["unobserve_property", frame_id])).await;
}
