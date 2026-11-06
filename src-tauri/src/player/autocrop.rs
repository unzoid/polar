//! Autocrop: zooming past the black bars, frame by frame (the rules are
//! `polar_player::crop`; this is the mpv side). Bars are read by cropdetect
//! inside mpv and by our own detector (`polar_player::bars`) from
//! screenshots, as `polar_player::sampler` decides: around cropdetect's
//! changes by default, every frame on macOS and with the setting.

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use polar_player::bars::{levels_for, Levels, Measured};
use polar_player::crop::{cropdetect_for, cropdetect_reading, zoom_for, CropTracker, CropZoom, Rect, CROPDETECT};
use polar_player::motion::Easing;
use polar_player::sampler::{Feed, Sampler};
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
    /// The cropdetect filter this video needs ([`cropdetect_for`]), and our
    /// detector's levels.
    filter: &'static str,
    levels: Levels,
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
        levels: levels_for(params.get("gamma").and_then(Value::as_str)),
        frame: 1.0 / fps.filter(|f| (1.0..=300.0).contains(f)).unwrap_or(24.0),
    })
}

/// A screenshot read by our detector, for the load and frame size it was taken in.
struct Shot {
    load: u64,
    size: (i64, i64),
    /// The reading (`Some(None)`: a black frame), `None` if no frame came.
    measured: Option<Option<Measured>>,
    /// Bytes mpv wrote for it (none on macOS, where it comes in memory).
    written: u64,
    /// Time spent reading it here (the file and our detector).
    ours: Duration,
}

/// Take a screenshot of the frame shown now and read it with our detector:
/// an uncompressed PNG mpv writes to this app's folder, read and deleted.
#[cfg(not(target_os = "macos"))]
async fn take_shot(app: AppHandle, load: u64, g: CropGeometry) -> Shot {
    use std::sync::atomic::AtomicU64;

    use polar_player::bars::detect;
    use polar_player::png::decode_stored;

    static NEXT: AtomicU64 = AtomicU64::new(0);
    let mut shot = Shot { load, size: g.size, measured: None, written: 0, ours: Duration::ZERO };
    let path = super::shots_dir().join(format!("autocrop-{}.png", NEXT.fetch_add(1, Ordering::Relaxed)));
    let mpv = &app.state::<AppState>().mpv;
    let taken = mpv.request(json!(["screenshot-to-file", path.to_string_lossy(), "video"])).await;
    let started = Instant::now();
    let bytes = tokio::fs::read(&path).await.ok();
    let _ = tokio::fs::remove_file(&path).await;
    let Some(bytes) = bytes.filter(|_| taken.is_ok()) else { return shot };
    shot.written = bytes.len() as u64;
    shot.measured = tokio::task::spawn_blocking(move || {
        let img = decode_stored(&bytes)?;
        Some(detect(&img.frame(), g.levels).map(|m| m.scaled((img.w as i64, img.h as i64), g.size)))
    })
    .await
    .ok()
    .flatten();
    shot.ours = started.elapsed();
    shot
}

/// Read the frame shown now with our detector, in memory: libmpv runs in
/// the app here ([`super::mac::Frames`]).
#[cfg(target_os = "macos")]
async fn take_shot(app: AppHandle, load: u64, g: CropGeometry) -> Shot {
    use std::sync::{Arc, Mutex as StdMutex};

    use polar_player::bars::detect;

    use super::{mac::Frames, Conn, Engine};

    /// The reader of the running player's frames, by the player it reads.
    static FRAMES: StdMutex<Option<(usize, Arc<Frames>)>> = StdMutex::new(None);

    let mut shot = Shot { load, size: g.size, measured: None, written: 0, ours: Duration::ZERO };
    let frames = {
        let state = app.state::<AppState>();
        let guard = state.mpv.conn.lock().await;
        let Some(Conn { engine: Engine::InApp(player), .. }) = guard.as_ref() else { return shot };
        let key = player as *const _ as usize;
        let mut cached = FRAMES.locked();
        match cached.as_ref() {
            Some((k, f)) if *k == key => f.clone(),
            _ => {
                let Some(f) = player.frames().map(Arc::new) else { return shot };
                *cached = Some((key, f.clone()));
                f
            }
        }
    };
    let started = Instant::now();
    let read = tokio::task::spawn_blocking(move || {
        frames.read(|frame| detect(&frame, g.levels).map(|m| m.scaled((frame.w as i64, frame.h as i64), g.size)))
    })
    .await
    .ok()
    .flatten();
    if read.is_none() {
        // The player may have gone: open a reader of the next one.
        *FRAMES.locked() = None;
    }
    shot.measured = read;
    shot.ours = started.elapsed();
    shot
}

/// A screenshot that hasn't come back after this long no longer holds up the next.
const SHOT_GIVE_UP: Duration = Duration::from_secs(2);
/// How often the screenshots' cost goes to the log.
const COST_EVERY: Duration = Duration::from_secs(10);

/// What our detector's screenshots cost, logged every [`COST_EVERY`] while
/// they're taken (docs/autocrop.md §2, measured on the desktop build).
#[derive(Default)]
struct Cost {
    since: Option<Instant>,
    shots: u64,
    written: u64,
    ours: Duration,
}

impl Cost {
    fn add(&mut self, shot: &Shot) {
        self.since.get_or_insert_with(Instant::now);
        self.shots += 1;
        self.written += shot.written;
        self.ours += shot.ours;
        let Some(since) = self.since.filter(|s| s.elapsed() >= COST_EVERY) else { return };
        let secs = since.elapsed().as_secs_f64();
        tracing::info!(
            "autocrop: {:.1} screenshots/s, {:.1} MB/s written, {:.1} ms each reading them here",
            self.shots as f64 / secs,
            self.written as f64 / secs / 1e6,
            self.ours.as_secs_f64() * 1000.0 / self.shots as f64,
        );
        *self = Cost::default();
    }
}

/// While autocrop is on: mpv reports cropdetect's reading whenever it
/// changes, and the playback position once per displayed frame, observed in
/// that order so each frame's reading arrives before its tick. [`Sampler`]
/// says which reading of each frame goes to [`CropTracker`] (cropdetect's,
/// or our detector's from a screenshot, [`take_shot`], one at a time), and
/// [`CropZoom`] moves the zoom: at once for a
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
    let mut sampler = Sampler::new(app.state::<AppState>().mpv.tuned.locked().sampling());
    let (shot_tx, mut shot_rx) = mpsc::unbounded_channel::<Shot>();
    let mut in_flight: Option<Instant> = None; // the screenshot on its way, since when
    let mut cost = Cost::default();
    loop {
        let event = tokio::select! {
            e = tokio::time::timeout(Duration::from_millis(500), rx.recv()) => e,
            Some(shot) = shot_rx.recv() => {
                in_flight = None;
                cost.add(&shot);
                let load = app.state::<AppState>().mpv.loads.load(Ordering::SeqCst);
                if let Some(m) = shot.measured.filter(|_| shot.load == load && geometry.is_some_and(|(g, _)| g.size == shot.size)) {
                    sampler.measured(m);
                }
                continue;
            }
        };
        let state = app.state::<AppState>();
        let mpv = &state.mpv;
        let tune = *mpv.tuned.locked();
        if !tune.autocrop || mpv.autocrop_run.load(Ordering::SeqCst) != run {
            break;
        }
        // The setting changed: mpv_tune has added or removed cropdetect.
        if tune.sampling() != sampler.sampling() {
            sampler = Sampler::new(tune.sampling());
            (filter, reading) = (CROPDETECT, None);
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
        if tune.cropdetect() && g.filter != filter {
            if !mpv.tuned.locked().cropdetect() {
                continue;
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
            sampler.reset();
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
            match sampler.frame(reading.filter(|_| tune.cropdetect()), tracker.following()) {
                Feed::Cropdetect(r) => tracker.update(load, g.size, g.display, r),
                Feed::Measured(m) => tracker.update_measured(load, g.size, g.display, m),
                // No reading for this frame: a lookahead cut still lands on it.
                Feed::Wait => tracker.update(load, g.size, g.display, None),
            }
            if sampler.wants_shot() && in_flight.is_none_or(|t| t.elapsed() >= SHOT_GIVE_UP) {
                in_flight = Some(Instant::now());
                let (app, tx) = (app.clone(), shot_tx.clone());
                tauri::async_runtime::spawn(async move {
                    let _ = tx.send(take_shot(app, load, g).await);
                });
            }
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
