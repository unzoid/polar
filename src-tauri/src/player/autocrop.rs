//! Autocrop: zooming past the black bars cropdetect finds, frame by frame
//! (the rules are `polar_player::crop`; this is the mpv side).

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use polar_player::crop::{cropdetect_for, cropdetect_reading, zoom_for, CropTracker, CropZoom, Rect, CROPDETECT};
use polar_player::motion::Easing;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};
use tokio::sync::mpsc;

use super::preroll::{ahead, Opening};
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
    /// How long a frame lasts, in seconds (1/24 when mpv doesn't say).
    frame: f64,
}

async fn crop_geometry(mpv: &Mpv) -> Option<CropGeometry> {
    let params = mpv.request(json!(["get_property", "video-params"])).await.ok()?;
    let osd = mpv.request(json!(["get_property", "osd-dimensions"])).await.ok()?;
    let fps = mpv.request(json!(["get_property", "container-fps"])).await.ok().and_then(|f| f.as_f64());
    let int = |v: &Value, k: &str| v.get(k).and_then(Value::as_i64).filter(|n| *n > 0);
    Some(CropGeometry {
        size: (int(&params, "w")?, int(&params, "h")?),
        display: (int(&params, "dw")?, int(&params, "dh")?),
        window: (int(&osd, "w")?, int(&osd, "h")?),
        filter: cropdetect_for(params.get("gamma").and_then(Value::as_str)),
        frame: 1.0 / fps.filter(|f| (1.0..=300.0).contains(f)).unwrap_or(24.0),
    })
}

/// While autocrop is on: mpv reports cropdetect's reading whenever it
/// changes, and the playback position once per displayed frame, observed in
/// that order so each frame's reading arrives before its tick. Every frame
/// goes to [`CropTracker`], and [`CropZoom`] moves the zoom: at once for a
/// switch the tracker believes on the frame it happens (readings run a
/// frame ahead of the screen, as mpv filters a frame before showing it, so
/// it lands on the cut) and for bars the film animates, eased (ease-out)
/// for one believed a few frames late. A change the lookahead
/// ([`preroll::ahead`](super::preroll::ahead)) scheduled goes to the tracker
/// as a cut on the frame it's due, ahead of that frame's reading. While paused
/// no frames come and nothing changes, except finishing a move and keeping
/// the zoom right for the window.
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
    let mut zoom = CropZoom::new(Easing::default());
    let clock = Instant::now();
    let mut filter = CROPDETECT; // what mpv_tune added
    let mut opened = 0; // the last load checked for opening bars
    loop {
        let event = tokio::time::timeout(Duration::from_millis(500), rx.recv()).await;
        let state = app.state::<AppState>();
        let mpv = &state.mpv;
        if !mpv.tuned.locked().autocrop || mpv.autocrop_run.load(Ordering::SeqCst) != run {
            break;
        }
        // mpv was shut down (idle, or it exited): the next start turns autocrop on afresh.
        if mpv.conn.lock().await.is_none() {
            break;
        }
        let frame = match event {
            Ok(None) => break, // a newer run took over
            Ok(Some((id, data))) if id == meta_id => {
                reading = cropdetect_reading(&data);
                continue;
            }
            Ok(Some((id, data))) if id == frame_id => data.as_f64(),
            Ok(Some(_)) => continue,
            Err(_) => None, // nothing for 500 ms: paused
        };
        let load = mpv.loads.load(Ordering::SeqCst);
        // The window changes size (fullscreen) and the video rarely does:
        // re-read them 4 times a second, and on every idle tick.
        if let Some(t) = frame {
            mpv.playhead.store(t.to_bits(), Ordering::SeqCst);
        }
        if frame.is_none() || geometry.is_none_or(|(_, at)| at.elapsed() >= Duration::from_millis(250)) {
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
        // The pre-roll probe's opening bars: wait for them (the load is
        // paused meanwhile), then start this load's tracker with them.
        // Then the lookahead starts from those bars.
        if opened != load {
            let bars = {
                let mut slot = mpv.opening.locked();
                match *slot {
                    Some(Opening::Probing(l)) if l == load => continue,
                    Some(Opening::Ready { load: l, full, bars }) if l == load => {
                        tracker.open(load, full, bars);
                        *slot = None;
                        bars
                    }
                    _ => (0, 0),
                }
            };
            opened = load;
            let source = mpv.source.locked().clone().filter(|(l, ..)| *l == load);
            if let Some((_, url, fields)) = source.filter(|_| mpv.tuned.locked().lookahead) {
                tauri::async_runtime::spawn(ahead(app.clone(), run, load, url, fields, bars));
            }
        }
        if let Some(t) = frame {
            // The reading is of the next frame (mpv filters one ahead): so is the change.
            let due = mpv.ahead.locked().as_mut().and_then(|s| s.take(load, t + g.frame));
            if let Some(change) = due {
                tracker.cut(load, g.size, change.bars);
            }
            tracker.update(load, g.size, g.display, reading);
        }
        let target = zoom_for(tracker.bars(load), g.size, g.display, g.window);
        let at_once = frame.is_some() && tracker.on_cut();
        if let Some(z) = zoom.next(load, g.window, target, at_once, clock.elapsed().as_secs_f64()) {
            if mpv.request(json!(["set_property", "video-zoom", z])).await.is_err() {
                zoom.unsent();
            }
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
