//! Autocrop: which black bars to remove, and the zoom that removes them.

use std::collections::VecDeque;

use serde_json::Value;

use crate::bars::Measured;
use crate::motion::{Easing, Glide};

/// Finds the picture's edges in each frame (`reset=1`: no memory between
/// frames; [`CropTracker`] does the remembering): rows and columns whose
/// average is above `limit` (a fraction of the signal range) are picture.
/// It needs decoded frames in memory, hence `Tune::hwdec_mode`'s copy-back.
pub const CROPDETECT: &str = "@autocrop:lavfi=[cropdetect=limit=0.09:round=2:reset=1]";

/// The same for HDR (PQ or HLG). Dark picture sits much nearer black in an
/// HDR signal, so at 0.09 the dim rows next to the bars of a dark shot read
/// as bar, by different amounts at top and bottom, and the uneven bars were
/// rightly not believed. Measured on a 4K HDR10 episode: 0.09 gave bars of
/// 306 and 416 px, 0.07 gave 264 and 282 (the real ones are ~264), while a
/// dark full-frame shot still read as full frame.
pub const CROPDETECT_HDR: &str = "@autocrop:lavfi=[cropdetect=limit=0.07:round=2:reset=1]";

/// The cropdetect filter for video with this `video-params/gamma`.
pub fn cropdetect_for(gamma: Option<&str>) -> &'static str {
    match gamma {
        Some("pq" | "hlg") => CROPDETECT_HDR,
        _ => CROPDETECT,
    }
}

/// cropdetect's reading from `vf-metadata/autocrop`.
pub fn cropdetect_reading(meta: &Value) -> Option<Rect> {
    let num =
        |k: &str| meta.get(format!("lavfi.cropdetect.{k}")).and_then(Value::as_str).and_then(|v| v.parse::<i64>().ok());
    Some(Rect { w: num("w")?, h: num("h")?, x: num("x")?, y: num("y")? })
}

/// Whether `zoom` is worth sending after `sent`. Like madVR's "disable
/// scaling if image size changes by only 2 lines or less", a size change
/// under 1% isn't worth a visible jump; going back to no zoom always is.
pub fn zoom_changed(sent: Option<(u64, f64)>, load: u64, zoom: f64) -> bool {
    match sent {
        Some((l, s)) if l == load => {
            if zoom == 0.0 {
                s != 0.0
            } else {
                ((zoom - s) * std::f64::consts::LN_2).abs() >= 0.01
            }
        }
        _ => true,
    }
}

/// The `video-zoom` (log2 of the scale) that makes the picture inside `bars`
/// (each side's thickness: top and bottom, left and right, in video pixels)
/// fill the window as far as its shape allows.
///
/// Zoom rather than `video-crop`: mpv lays ASS subtitles out over the
/// displayed video, and a crop changes that area's shape, which stretches
/// dialogue in any script with `LayoutResX/Y` (most anime releases). A zoom
/// keeps the shape; with `sub-ass-force-margins` and
/// `sub-ass-scale-with-window` dialogue then stays put at its normal size.
pub fn zoom_for((v, h): (i64, i64), (w, hgt): (i64, i64), (dw, dh): (i64, i64), (win_w, win_h): (i64, i64)) -> f64 {
    if v <= 0 && h <= 0 {
        return 0.0;
    }
    let (sx, sy) = (dw as f64 / w as f64, dh as f64 / hgt as f64);
    let fit = |pw: f64, ph: f64| (win_w as f64 / pw).min(win_h as f64 / ph);
    let full = fit(dw as f64, dh as f64);
    let picture = fit((w - 2 * h) as f64 * sx, (hgt - 2 * v) as f64 * sy);
    (picture / full).log2().max(0.0)
}

/// The `video-zoom` to send mpv, frame by frame (docs/autocrop.md §6): a
/// change [`CropTracker::on_cut`] says lands with the picture, a new file
/// or a new window size is shown at once; any other change of 1% or more
/// ([`zoom_changed`]) glides along `easing`, sent on every frame until it
/// settles. Times are seconds on a steady clock.
#[derive(Debug, Clone)]
pub struct CropZoom {
    glide: Glide,
    /// The load and window size the glide belongs to.
    load: Option<u64>,
    window: (i64, i64),
    /// The zoom mpv has (`None`: unknown, send the next one).
    sent: Option<f64>,
}

impl CropZoom {
    pub fn new(easing: Easing) -> Self {
        CropZoom { glide: Glide::new(easing, 0.0), load: None, window: (0, 0), sent: None }
    }

    /// The zoom to send now, if it differs from what mpv has. `target` is
    /// [`zoom_for`] the tracker's bars; `at_once` is its [`on_cut`](CropTracker::on_cut).
    pub fn next(&mut self, load: u64, window: (i64, i64), target: f64, at_once: bool, now: f64) -> Option<f64> {
        let fresh = self.load != Some(load) || self.window != window;
        if fresh {
            (self.load, self.window) = (Some(load), window);
            self.glide.jump(target, now);
        } else if target != self.glide.target() {
            if at_once {
                self.glide.jump(target, now);
            } else if zoom_changed(Some((load, self.glide.target())), load, target) {
                self.glide.go(target, now);
            }
        }
        let zoom = self.glide.at(now);
        if self.sent.is_some_and(|s| (s - zoom).abs() < 1e-6) {
            return None;
        }
        self.sent = Some(zoom);
        Some(zoom)
    }

    /// mpv didn't take the last zoom: send again next time.
    pub fn unsent(&mut self) {
        self.sent = None;
    }
}

/// A picture area in video pixels, as cropdetect reports it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub w: i64,
    pub h: i64,
    pub x: i64,
    pub y: i64,
}

/// Frames kept to judge the bars by (half a second at 24 fps).
const CROP_HISTORY: usize = 12;
/// Frames bar edges must hold still for before they're cropped: bars this
/// file has shown before, and bars that leave a common picture shape. Any
/// other shape needs [`CROP_HISTORY`]. Crisp bars (only our own detector,
/// `bars`, tells) are cropped on their first frame when they leave a common
/// shape, else as known bars.
const KNOWN_FRAMES: usize = 2;
const COMMON_FRAMES: usize = 4;
/// How far apart (pixels) readings of the same bar edge may be. A real bar's
/// edge is crisp and found on the same row every frame; dark picture content
/// fades out at a different row from one frame to the next.
const EDGE_SLACK: i64 = 4;
/// Picture shapes films and shows are made in. Bars that leave one of these
/// are believed sooner than bars that leave an odd shape.
const COMMON_ASPECTS: &[f64] = &[1.33, 1.37, 1.43, 1.5, 1.66, 1.78, 1.85, 1.9, 2.0, 2.2, 2.35, 2.39, 2.4, 2.55, 2.76];

/// Keyframes the pre-roll probe measures over a film's opening before
/// playback starts (docs/autocrop.md §3), and how many must agree on bars.
pub const OPENING_SAMPLES: usize = 8;
const OPENING_AGREE: usize = 5;

/// Where the pre-roll probe measures, in seconds: [`OPENING_SAMPLES`]
/// points spread over the 3 minutes from where playback starts (`start`,
/// 0 for the beginning, which skips the first 10 s: often logos on black),
/// short of the end. Nothing for less than 15 s to measure or a video of
/// unknown length (a live stream), which starts uncropped as before.
pub fn opening_points(duration: Option<f64>, start: f64) -> Vec<f64> {
    let Some(d) = duration.filter(|d| d.is_finite()) else {
        return Vec::new();
    };
    let from = if start > 1.0 { start } else { 10.0 };
    let to = (d - 5.0).min(from + 180.0);
    if to - from < 15.0 {
        return Vec::new();
    }
    (0..OPENING_SAMPLES).map(|i| from + (to - from) * (i as f64 + 0.5) / OPENING_SAMPLES as f64).collect()
}

/// The bars to remove from the very first frame, from our own detector's
/// readings of keyframes spread over the opening minutes (the pre-roll
/// probe). Per axis, bars at least 5 of 8 readings measure crisp on both
/// sides, even and within [`EDGE_SLACK`] of each other; the thinnest of
/// those, so nothing is cut that any of them showed as picture. Fades
/// (`None`) and readings without crisp bars don't vote, so anything less
/// clear starts uncropped, as without the probe. Give the result to
/// [`CropTracker::open`].
pub fn opening_bars(full: (i64, i64), readings: &[Option<Measured>]) -> (i64, i64) {
    let need = (readings.len() * OPENING_AGREE).div_ceil(OPENING_SAMPLES).max(1);
    let (fw, fh) = full;
    let axis_bars = |axis: usize| {
        let dim = if axis == 0 { fh } else { fw };
        let even = ((dim as f64 * 0.02).round() as i64).max(EDGE_SLACK);
        let votes: Vec<i64> = readings
            .iter()
            .flatten()
            .filter(|m| m.crisp[2 * axis] && m.crisp[2 * axis + 1])
            .filter_map(|m| {
                let r = m.rect;
                let (a, b) = if axis == 0 { (r.y, fh - r.y - r.h) } else { (r.x, fw - r.x - r.w) };
                ((a - b).abs() <= even && a.min(b) * 100 >= dim).then_some(a.min(b))
            })
            .collect();
        let agree = |v: i64| votes.iter().filter(move |&&o| (o - v).abs() <= EDGE_SLACK);
        votes
            .iter()
            .filter(|&&v| agree(v).count() >= need)
            .max_by_key(|&&v| agree(v).count())
            .and_then(|&v| agree(v).min().copied())
            .unwrap_or(0)
    };
    let (v, h) = (axis_bars(0), axis_bars(1));
    if (fw - 2 * h) * (fh - 2 * v) * 10 < fw * fh * 4 {
        return (0, 0);
    }
    (v, h)
}

/// Which bars to remove, from cropdetect's per-frame readings, in the spirit
/// of madVR's black bar detection. It changes both ways, quickly, and is
/// careful only where a mistake would cut picture off:
///
///  * Picture showing up where a bar was cropped: un-crop on the first frame
///    when that goes back to full frame or to bars this file has shown (a
///    16:9 shot after a letterboxed one), otherwise after 2 frames, so a
///    stray frame doesn't (subtitles burnt into a bar still do).
///  * Bars appearing or getting thicker: crop once the bar edges have sat on
///    the same rows for [`KNOWN_FRAMES`] if this file has shown those bars
///    before, [`COMMON_FRAMES`] for a common picture shape, and
///    [`CROP_HISTORY`] for an odd one. Opposite bars must be even, as
///    letterboxing is; a dark scene lit on one side isn't a bar. The picture
///    must be at least 40% of the frame.
///  * Black frames (fades) say nothing either way.
///  * Bars thinner than 1% a side aren't worth cropping.
///  * With [`update_measured`](Self::update_measured), bars whose edges are
///    crisp on both sides need fewer frames: 1 for a common shape, 2 for
///    any other. A wrong crop costs one frame, since it's undone as soon as
///    picture shows in the bar.
///  * Bars the film animates itself (they open or close over a shot): once
///    3 frames in a row have crisp edges moving the same way, each frame's
///    bars are shown as they are, with no hold ([`following`](Self::following)),
///    until the edges hold still for 2 frames or stop being crisp.
///
/// Each axis is judged on its own, so a dark vignette at the sides doesn't
/// hold up cropping the letterbox.
#[derive(Debug, Default)]
pub struct CropTracker {
    /// The `Mpv::loads` and frame size these readings belong to.
    load: u64,
    full: (i64, i64),
    /// Bar thickness per frame, `[top, bottom, left, right]`, oldest first.
    recent: VecDeque<[i64; 4]>,
    /// Whether the newest frame's bars are crisp on both sides, per axis,
    /// and for how many frames in a row they have been.
    crisp: [bool; 2],
    crisp_run: [usize; 2],
    /// Per axis: following bars the film animates.
    follow: [bool; 2],
    /// Bars removed now: (top and bottom, left and right).
    shown: (i64, i64),
    /// Bar thicknesses cropped earlier in this load, per axis.
    known: [Vec<i64>; 2],
    /// How the newest frame changed the bars, if it did.
    change: Option<Why>,
    /// A change from the lookahead applied on the frame about to be fed.
    cut: Option<Why>,
}

/// Which rule changed the bars on a frame (docs/autocrop.md §6), for the
/// log line of each change and for [`CropTracker::on_cut`]: the zoom jumps
/// for all but [`Why::Late`], which is eased, the same way every time.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Why {
    /// The lookahead read the new bars on this keyframe.
    Keyframe,
    /// The lookahead knew the bars change before its next keyframe, and
    /// this frame's own reading is the first to show them.
    Window,
    /// This frame's own reading changed the bars on the frame they changed.
    Cut,
    /// Bars the film animates, followed frame by frame.
    Follow,
    /// Believed frames after they changed, or from a reading that came
    /// late (a screenshot): away from the cut.
    Late,
}

impl Why {
    /// Said in the log: what decided the change and whether it jumped.
    pub fn describe(self) -> &'static str {
        match self {
            Why::Keyframe => "on the cut: jump (lookahead, keyframe)",
            Why::Window => "on the cut: jump (lookahead, found between keyframes)",
            Why::Cut => "on the cut: jump (this frame's reading)",
            Why::Follow => "following animated bars: frame by frame",
            Why::Late => "away from the cut: eased",
        }
    }
}

impl CropTracker {
    /// The bars to remove for `load`: none before its first reading.
    pub fn bars(&self, load: u64) -> (i64, i64) {
        if load == self.load {
            self.shown
        } else {
            (0, 0)
        }
    }

    /// Start `load` with `bars` already removed ([`opening_bars`]), as if
    /// this file had shown them: picture in them un-crops on its first frame.
    pub fn open(&mut self, load: u64, full: (i64, i64), bars: (i64, i64)) {
        *self = CropTracker { load, full, shown: bars, ..Default::default() };
        for (known, b) in self.known.iter_mut().zip([bars.0, bars.1]) {
            if b > 0 {
                known.push(b);
            }
        }
    }

    /// Feed one frame's reading (`None` if cropdetect had nothing).
    /// `display` is the frame's display size, for non-square pixels.
    pub fn update(&mut self, load: u64, full: (i64, i64), display: (i64, i64), reading: Option<Rect>) {
        self.feed(load, full, display, reading, [false; 2], true);
    }

    /// Feed one frame as our own detector measured it (`None`: a black frame).
    pub fn update_measured(&mut self, load: u64, full: (i64, i64), display: (i64, i64), measured: Option<Measured>) {
        let crisp = measured.map_or([false; 2], |m| [m.crisp[0] && m.crisp[1], m.crisp[2] && m.crisp[3]]);
        self.feed(load, full, display, measured.map(|m| m.rect), crisp, true);
    }

    /// The same for a reading that came frames after the frame it's of (a
    /// screenshot): a change it brings is never on the cut, so it's eased.
    pub fn update_late(&mut self, load: u64, full: (i64, i64), display: (i64, i64), measured: Option<Measured>) {
        let crisp = measured.map_or([false; 2], |m| [m.crisp[0] && m.crisp[1], m.crisp[2] && m.crisp[3]]);
        self.feed(load, full, display, measured.map(|m| m.rect), crisp, false);
    }

    fn feed(
        &mut self,
        load: u64,
        full: (i64, i64),
        display: (i64, i64),
        reading: Option<Rect>,
        crisp: [bool; 2],
        exact: bool,
    ) {
        if load != self.load || full != self.full {
            *self = CropTracker { load, full, ..Default::default() };
        }
        let cut = self.cut.take();
        self.change = cut;
        let (fw, fh) = full;
        // An all-black frame comes back as an empty or inside-out area.
        let Some(r) =
            reading.filter(|r| r.w > 0 && r.h > 0 && r.x >= 0 && r.y >= 0 && r.x + r.w <= fw && r.y + r.h <= fh)
        else {
            return;
        };
        if self.recent.len() == CROP_HISTORY {
            self.recent.pop_front();
        }
        self.recent.push_back([r.y, fh - r.y - r.h, r.x, fw - r.x - r.w]);
        self.crisp = crisp;
        for (run, crisp) in self.crisp_run.iter_mut().zip(crisp) {
            *run = if crisp { *run + 1 } else { 0 };
        }

        let shown = [self.shown.0, self.shown.1];
        let mut next = shown;
        for axis in 0..2 {
            self.follow[axis] = (self.follow[axis] || self.animated(axis)) && self.still_animated(axis);
            if self.follow[axis] {
                let newest = self.recent.back().map_or([0; 4], |r| *r);
                next[axis] = newest[2 * axis].min(newest[2 * axis + 1]);
            } else if let Some(thinner) = self.revealed(axis, shown[axis]) {
                next[axis] = thinner;
            } else if let Some(bars) = self.settled(axis, shown, display) {
                next[axis] = bars;
            }
        }
        for axis in 0..2 {
            if next[axis] > shown[axis]
                && !self.follow[axis]
                && !self.known[axis].iter().any(|k| (k - next[axis]).abs() <= EDGE_SLACK)
            {
                self.known[axis].push(next[axis]);
            }
        }
        let previous = (self.recent.len() >= 2).then(|| self.recent[self.recent.len() - 2]);
        let newest = self.recent.back().map_or([0; 4], |r| *r);
        let moved: Vec<usize> = (0..2).filter(|&axis| next[axis] != shown[axis]).collect();
        let on_frame = |axis: usize| {
            previous
                .is_none_or(|p| (0..2).any(|side| (p[2 * axis + side] - newest[2 * axis + side]).abs() > EDGE_SLACK))
        };
        if cut.is_none() && !moved.is_empty() {
            self.change = Some(if moved.iter().all(|&axis| self.follow[axis]) {
                Why::Follow
            } else if exact && moved.iter().all(|&axis| self.follow[axis] || on_frame(axis)) {
                Why::Cut
            } else {
                Why::Late
            });
        }
        self.shown = (next[0], next[1]);
    }

    /// Apply a change the lookahead scheduled on the frame about to be fed
    /// (docs/autocrop.md §4, [`Schedule`](crate::lookahead::Schedule)), before
    /// that frame's reading: the zoom jumps to it, landing on the cut. An
    /// axis whose bars the frame before already had is left alone, since
    /// they changed between keyframes and not here; so is a change that
    /// would leave less than 40% of the frame. Picture showing in the new
    /// bars un-crops on the next reading, as always. `why`: [`Why::Keyframe`]
    /// or [`Why::Window`], for the log.
    pub fn cut(&mut self, load: u64, full: (i64, i64), bars: [Option<i64>; 2], why: Why) {
        if load != self.load || full != self.full {
            return;
        }
        let shown = [self.shown.0, self.shown.1];
        let before = self.recent.back();
        let mut next = shown;
        for axis in 0..2 {
            let Some(b) = bars[axis].filter(|b| (b - shown[axis]).abs() > EDGE_SLACK) else { continue };
            if before.is_some_and(|p| (p[2 * axis].min(p[2 * axis + 1]) - b).abs() <= EDGE_SLACK) {
                continue;
            }
            next[axis] = b;
        }
        let (fw, fh) = full;
        if next == shown || (fw - 2 * next[1]) * (fh - 2 * next[0]) * 10 < fw * fh * 4 {
            return;
        }
        for (known, b) in self.known.iter_mut().zip(next) {
            if b > 0 && !known.iter().any(|k| (k - b).abs() <= EDGE_SLACK) {
                known.push(b);
            }
        }
        // The frames before the cut say nothing about the shot after it.
        (self.recent, self.crisp, self.crisp_run, self.follow) = (VecDeque::new(), [false; 2], [0; 2], [false; 2]);
        self.shown = (next[0], next[1]);
        self.cut = Some(why);
    }

    /// Whether the newest frame changed the bars on the very frame the
    /// picture's own bars changed (the first frame of a file, a cut, a known
    /// shape coming back) or by following animated bars: then the zoom jumps
    /// to it, since readings run a frame ahead of the screen and the jump
    /// lands with the picture. A change believed a few frames late, or
    /// from a late reading, is eased instead ([`CropZoom`]).
    pub fn on_cut(&self) -> bool {
        self.change.is_some_and(|w| w != Why::Late)
    }

    /// How the newest frame changed the bars, if it did.
    pub fn changed(&self) -> Option<Why> {
        self.change
    }

    /// Whether bars are being animated by the film: following them frame by frame.
    pub fn following(&self) -> bool {
        self.follow[0] || self.follow[1]
    }

    /// The last 3 frames' edges on `axis` are crisp and each moved the same
    /// way by a small step (at most 3% of the frame per frame).
    fn animated(&self, axis: usize) -> bool {
        let dim = if axis == 0 { self.full.1 } else { self.full.0 };
        if self.crisp_run[axis] < 3 || self.recent.len() < 3 {
            return false;
        }
        let last: Vec<&[i64; 4]> = self.recent.iter().rev().take(3).collect();
        let steps: Vec<i64> = (0..2)
            .flat_map(|side| (0..2).map(move |i| (side, i)))
            .map(|(side, i)| last[i][2 * axis + side] - last[i + 1][2 * axis + side])
            .collect();
        let way = steps[0].signum();
        way != 0 && steps.iter().all(|d| d.signum() == way && d.abs() * 100 <= dim * 3)
    }

    /// Still following on `axis`: crisp, not held still for 2 frames, and
    /// leaving at least 40% of the frame.
    fn still_animated(&self, axis: usize) -> bool {
        let dim = if axis == 0 { self.full.1 } else { self.full.0 };
        let mut last = self.recent.iter().rev();
        let (Some(a), Some(b)) = (last.next(), last.next()) else { return false };
        let held = a[2 * axis] == b[2 * axis] && a[2 * axis + 1] == b[2 * axis + 1];
        self.crisp[axis] && !held && (dim - 2 * a[2 * axis].min(a[2 * axis + 1])) * 10 >= dim * 4
    }

    /// Picture inside the cropped bars on `axis` (0: top/bottom, 1:
    /// left/right): the bar size that shows it. The newest frame is enough
    /// when it goes back to no bars or to bars this file has shown; anything
    /// else needs the last 2 frames to agree there's picture there.
    fn revealed(&self, axis: usize, shown: i64) -> Option<i64> {
        let dim = if axis == 0 { self.full.1 } else { self.full.0 };
        let mut last = self.recent.iter().rev().map(|r| r[2 * axis].min(r[2 * axis + 1]));
        let newest = last.next().filter(|&t| t < shown - EDGE_SLACK)?;
        let newest = if newest * 100 < dim { 0 } else { newest };
        if newest == 0 || self.known[axis].iter().any(|k| (k - newest).abs() <= EDGE_SLACK) {
            return Some(newest);
        }
        let before = last.next().filter(|&t| t < shown - EDGE_SLACK)?;
        Some(newest.min(before))
    }

    /// A new bar size on `axis` that recent frames agree on, if they've
    /// agreed for long enough to believe it.
    fn settled(&self, axis: usize, shown: [i64; 2], (dw, dh): (i64, i64)) -> Option<i64> {
        let (fw, fh) = self.full;
        let dim = if axis == 0 { fh } else { fw };
        let even = ((dim as f64 * 0.02).round() as i64).max(EDGE_SLACK);
        let edge = |n: usize, side: usize| self.recent.iter().rev().take(n).map(move |r| r[2 * axis + side]);
        // How many of the latest frames the bar edges have held still for.
        let held = [1, KNOWN_FRAMES, COMMON_FRAMES, CROP_HISTORY]
            .into_iter()
            .take_while(|&n| {
                self.recent.len() >= n
                    && (0..2)
                        .all(|side| edge(n, side).max().unwrap_or(0) - edge(n, side).min().unwrap_or(0) <= EDGE_SLACK)
            })
            .last()?;
        if held < KNOWN_FRAMES && !self.crisp[axis] {
            return None; // one frame is enough only for crisp bars
        }
        let (a, b) = (edge(held, 0).min().unwrap_or(0), edge(held, 1).min().unwrap_or(0));
        if (a - b).abs() > even {
            return None;
        }
        let bars = if a.min(b) * 100 >= dim { a.min(b) } else { 0 };
        if (bars - shown[axis]).abs() <= EDGE_SLACK {
            return None;
        }
        let mut both = shown;
        both[axis] = bars;
        let (pw, ph) = (fw - 2 * both[1], fh - 2 * both[0]);
        if pw * ph * 10 < fw * fh * 4 {
            return None;
        }
        if bars < shown[axis] {
            return Some(bars); // thinner bars: nothing more is cut off
        }
        let shape = (pw as f64 * dw as f64 / fw as f64) / (ph as f64 * dh as f64 / fh as f64);
        let common = COMMON_ASPECTS.iter().any(|c| (shape / c - 1.0).abs() <= 0.02);
        let needed = if self.crisp[axis] && common {
            1
        } else if self.crisp[axis] || self.known[axis].iter().any(|k| (k - bars).abs() <= EDGE_SLACK) {
            KNOWN_FRAMES
        } else if common {
            COMMON_FRAMES
        } else {
            CROP_HISTORY
        };
        (held >= needed).then_some(bars)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const HD: (i64, i64) = (1920, 1080);
    /// A 2.40:1 picture letterboxed in 16:9.
    const SCOPE: Rect = Rect { w: 1920, h: 800, x: 0, y: 140 };
    const FULL: Rect = Rect { w: 1920, h: 1080, x: 0, y: 0 };

    /// Feed `readings` (one per frame) to `t` for load 1; the bars after each.
    fn feed(t: &mut CropTracker, readings: &[Option<Rect>]) -> Vec<(i64, i64)> {
        readings
            .iter()
            .map(|r| {
                t.update(1, HD, HD, *r);
                t.bars(1)
            })
            .collect()
    }

    /// cropdetect's `WxH+X+Y`, as mpv reports it.
    fn rect(s: &str) -> Option<Rect> {
        let (w, rest) = s.split_once('x')?;
        let mut n = rest.split('+').map(|v| v.parse::<i64>().ok());
        Some(Rect { w: w.parse().ok()?, h: n.next()??, x: n.next()??, y: n.next()?? })
    }

    #[test]
    fn follows_a_real_clip_frame_by_frame() {
        let frames: Vec<(f64, Option<Rect>)> = include_str!("testdata/autocrop_frames.txt")
            .lines()
            .filter(|l| !l.starts_with('#'))
            .filter_map(|l| {
                let (t, r) = l.split_once(' ')?;
                Some((t.parse().ok()?, rect(r)))
            })
            .collect();
        assert!(frames.len() > 500);
        let mut t = CropTracker::default();
        let shown: Vec<(f64, (i64, i64))> = frames
            .iter()
            .map(|(time, r)| {
                t.update(1, HD, HD, *r);
                (*time, t.bars(1))
            })
            .collect();
        // Only ever the letterbox or nothing: the vignette's sides are never cropped.
        assert!(shown.iter().all(|(_, b)| *b == (0, 0) || *b == (140, 0)), "{shown:?}");
        let at =
            |from: f64, to: f64| shown.iter().filter(move |(time, _)| *time >= from && *time < to).map(|(_, b)| *b);
        let frame = 1.0 / 24.0;
        // New bars at 3.958 s (the reading for the 4.0 s frame): cropped 4 frames later.
        assert!(at(3.958 + 3.0 * frame + 0.001, 9.95).all(|b| b == (140, 0)), "{shown:?}");
        // Back to full frame at 9.958 s: on that very frame, so it lands on the cut.
        assert!(at(9.958, 13.95).all(|b| b == (0, 0)), "{shown:?}");
        // The dark letterbox: bars seen before, cropped 2 frames after they first show.
        let first =
            frames.iter().find(|(time, r)| *time > 14.0 && r.is_some_and(|r| r.y == 140 && r.h == 800)).unwrap().0;
        assert!(at(first + frame + 0.001, 19.95).all(|b| b == (140, 0)), "{shown:?}");
        assert!(at(19.958, 99.0).all(|b| b == (0, 0)), "{shown:?}");
    }

    #[test]
    fn finds_the_bars_of_a_dark_hdr_shot() {
        // 4K HDR10, cropdetect at CROPDETECT_HDR's limit, sampled every 100 ms;
        // the letterboxed shot starts at 174.0 s.
        let uhd = (3840, 2160);
        let mut t = CropTracker::default();
        let mut shown = Vec::new();
        for l in include_str!("testdata/autocrop_hdr.txt").lines().filter(|l| !l.starts_with('#')) {
            let Some((time, r)) = l.split_once(' ') else { continue };
            t.update(1, uhd, uhd, rect(r));
            shown.push((time.parse::<f64>().unwrap(), t.bars(1)));
        }
        assert!(shown.iter().filter(|(time, _)| *time < 174.0).all(|(_, b)| *b == (0, 0)));
        let cropped: Vec<_> = shown.iter().filter(|(time, _)| *time >= 175.0).map(|(_, b)| *b).collect();
        assert!(!cropped.is_empty() && cropped.iter().all(|&(v, h)| (262..=268).contains(&v) && h == 0), "{shown:?}");
        assert_eq!(cropdetect_for(Some("pq")), CROPDETECT_HDR);
        assert_eq!(cropdetect_for(Some("hlg")), CROPDETECT_HDR);
        assert_eq!(cropdetect_for(Some("bt.1886")), CROPDETECT);
        assert_eq!(cropdetect_for(None), CROPDETECT);
    }

    #[test]
    fn crops_in_a_few_frames_and_known_bars_sooner() {
        let mut t = CropTracker::default();
        assert_eq!(feed(&mut t, &[Some(FULL); 6]).last(), Some(&(0, 0)));
        assert_eq!(feed(&mut t, &[Some(SCOPE); 3]).last(), Some(&(0, 0)));
        assert_eq!(feed(&mut t, &[Some(SCOPE)]).last(), Some(&(140, 0)), "4 frames");
        assert_eq!(feed(&mut t, &[Some(FULL)]).last(), Some(&(0, 0)), "1 frame back to full");
        assert_eq!(feed(&mut t, &[Some(SCOPE)]).last(), Some(&(0, 0)));
        assert_eq!(feed(&mut t, &[Some(SCOPE)]).last(), Some(&(140, 0)), "the same bars again: 2 frames");
    }

    #[test]
    fn a_flash_in_a_bar_or_black_frames_change_nothing() {
        let mut t = CropTracker::default();
        feed(&mut t, &[Some(SCOPE); 5]);
        let flash = Rect { w: 1920, h: 960, x: 0, y: 60 };
        let black = Rect { w: -1918, h: -1078, x: 1920, y: 1080 };
        let readings = [Some(flash), Some(SCOPE), None, Some(black), Some(black), Some(flash), Some(SCOPE)];
        assert!(feed(&mut t, &readings).iter().all(|b| *b == (140, 0)));
    }

    #[test]
    fn dark_scenes_in_full_frame_need_longer_for_odd_shapes() {
        let mut t = CropTracker::default();
        feed(&mut t, &[Some(FULL); 3]);
        // Dark at top and bottom, evenly, holding still: a 2.13:1 shape, which films aren't made in.
        let dark = Rect { w: 1920, h: 900, x: 0, y: 90 };
        assert!(feed(&mut t, &[Some(dark); 11]).iter().all(|b| *b == (0, 0)));
        assert_eq!(feed(&mut t, &[Some(dark)]).last(), Some(&(90, 0)), "after 1.2 s");
        // Lit on one side only: never bars.
        let lopsided = Rect { w: 1920, h: 900, x: 0, y: 30 };
        let mut t = CropTracker::default();
        assert!(feed(&mut t, &[Some(lopsided); 20]).iter().all(|b| *b == (0, 0)));
    }

    #[test]
    fn subtitles_burnt_into_a_bar_are_shown() {
        let mut t = CropTracker::default();
        feed(&mut t, &[Some(SCOPE); 5]);
        let subtitles = Rect { w: 1920, h: 880, x: 0, y: 140 }; // 60 px of bar left below them
        assert_eq!(feed(&mut t, &[Some(subtitles); 2]).last(), Some(&(60, 0)));
        assert_eq!(feed(&mut t, &[Some(SCOPE); 3]).last(), Some(&(140, 0)), "cropped again once they're gone");
    }

    #[test]
    fn crisp_bars_crop_on_their_first_frame() {
        let crisp = |rect: Rect, c: [bool; 4]| Some(Measured { rect, crisp: c });
        let mut t = CropTracker::default();
        t.update_measured(1, HD, HD, crisp(FULL, [false; 4]));
        t.update_measured(1, HD, HD, crisp(SCOPE, [true, true, false, false]));
        assert_eq!(t.bars(1), (140, 0), "2.40:1 with crisp edges: at once");
        t.update_measured(1, HD, HD, crisp(FULL, [false; 4]));
        assert_eq!(t.bars(1), (0, 0));
        // An odd shape with crisp edges: 2 frames.
        let odd = Rect { w: 1920, h: 900, x: 0, y: 90 };
        t.update_measured(1, HD, HD, crisp(odd, [true, true, false, false]));
        assert_eq!(t.bars(1), (0, 0));
        t.update_measured(1, HD, HD, crisp(odd, [true, true, false, false]));
        assert_eq!(t.bars(1), (90, 0));
        // Crisp on one side only: the usual 4 frames for a common shape.
        let mut t = CropTracker::default();
        for n in 1..=4 {
            t.update_measured(1, HD, HD, crisp(SCOPE, [true, false, false, false]));
            assert_eq!(t.bars(1), if n < 4 { (0, 0) } else { (140, 0) }, "frame {n}");
        }
        // Black frames say nothing, as with cropdetect.
        t.update_measured(1, HD, HD, None);
        assert_eq!(t.bars(1), (140, 0));
    }

    #[test]
    fn bars_the_film_animates_are_followed_frame_by_frame() {
        let crisp_scope = |v: i64| {
            Some(Measured { rect: Rect { w: 1920, h: 1080 - 2 * v, x: 0, y: v }, crisp: [v > 0, v > 0, false, false] })
        };
        // The bars open, 140 to 0 in steps of 7 px (20 frames), then full frame.
        let mut t = CropTracker::default();
        let mut shown = Vec::new();
        for v in (0..=20).map(|i| 140 - 7 * i).chain([0, 0]) {
            t.update_measured(1, HD, HD, crisp_scope(v));
            shown.push((v, t.bars(1).0, t.following()));
        }
        // From the 3rd frame of the move on, exactly the picture's bars.
        assert!(shown[2..].iter().all(|&(v, b, _)| b == v), "{shown:?}");
        assert!(shown[2..20].iter().all(|&(_, _, f)| f) && !shown[21].2, "{shown:?}");
        // Closing, 0 to 140: followed too, and left when the bars hold still.
        let mut t = CropTracker::default();
        let mut shown = Vec::new();
        for v in (0..=14).map(|i| 10 * i).chain([140, 140, 140]) {
            t.update_measured(1, HD, HD, crisp_scope(v));
            shown.push((v, t.bars(1).0, t.following()));
        }
        assert!(shown[3..].iter().all(|&(v, b, _)| b == v), "{shown:?}");
        assert!(!shown.last().unwrap().2, "{shown:?}");
        // Edges that only jitter, or aren't crisp, are never followed.
        let mut t = CropTracker::default();
        for v in [140, 138, 140, 138, 140, 138] {
            t.update_measured(1, HD, HD, crisp_scope(v));
            assert!(!t.following());
        }
        let mut t = CropTracker::default();
        for v in [140, 130, 120, 110, 100] {
            t.update(1, HD, HD, crisp_scope(v).map(|m| m.rect));
            assert!(!t.following());
        }
    }

    #[test]
    fn each_load_starts_over() {
        let mut t = CropTracker::default();
        feed(&mut t, &[Some(SCOPE); 5]);
        assert_eq!(t.bars(1), (140, 0));
        assert_eq!(t.bars(2), (0, 0), "a new load shows nothing cropped before its first frame");
        t.update(2, HD, HD, Some(SCOPE));
        assert_eq!(t.bars(2), (0, 0));
        // A different frame size within one load (a new video track) too.
        feed(&mut t, &[Some(SCOPE); 5]);
        t.update(1, (3840, 2160), (3840, 2160), Some(SCOPE));
        assert_eq!(t.bars(1), (0, 0));
    }

    #[test]
    fn zoom_fills_the_window_only_as_far_as_the_picture_allows() {
        let ultrawide = (2000, 837);
        assert_eq!(zoom_for((0, 0), HD, HD, ultrawide), 0.0);
        // A 2.40:1 picture on a 2.39:1 window: limited by the width.
        let z = zoom_for((140, 0), HD, HD, ultrawide);
        assert!((2f64.powf(z) - (2000.0 / 1920.0) / (837.0 / 1080.0)).abs() < 1e-9, "{z}");
        // On a 16:9 window the letterbox already fits: nothing to zoom.
        assert_eq!(zoom_for((140, 0), HD, HD, (1920, 1080)), 0.0);
        // Cropping the sides of a picture that's already pillarboxed changes nothing.
        assert_eq!(zoom_for((0, 240), HD, HD, ultrawide), 0.0);
        // Anamorphic 1440x1080 shown as 1920x1080: same as square pixels.
        assert!((zoom_for((140, 0), (1440, 1080), HD, ultrawide) - z).abs() < 1e-9);
    }

    #[test]
    fn small_zoom_changes_are_skipped() {
        assert!(zoom_changed(None, 1, 0.0));
        assert!(zoom_changed(Some((1, 0.4)), 2, 0.4), "a new load");
        assert!(!zoom_changed(Some((1, 0.4)), 1, 0.405));
        assert!(zoom_changed(Some((1, 0.4)), 1, 0.43));
        assert!(zoom_changed(Some((1, 0.01)), 1, 0.0), "back to none always");
        assert!(!zoom_changed(Some((1, 0.0)), 1, 0.0));
    }

    #[test]
    fn changes_on_the_frame_the_bars_change_are_on_the_cut() {
        let crisp = |rect: Rect| Some(Measured { rect, crisp: [true, true, false, false] });
        let mut t = CropTracker::default();
        t.update_measured(1, HD, HD, crisp(SCOPE));
        assert!(t.on_cut(), "the first frame of a file");
        t.update_measured(1, HD, HD, crisp(SCOPE));
        assert!(!t.on_cut(), "no change");
        t.update(1, HD, HD, Some(FULL));
        assert!(t.on_cut(), "back to full frame on the cut");
        // cropdetect: a new shape believed 4 frames after the cut is late.
        let mut t = CropTracker::default();
        let late: Vec<bool> = (0..4)
            .map(|_| {
                t.update(1, HD, HD, Some(SCOPE));
                t.on_cut()
            })
            .collect();
        assert_eq!((t.bars(1), late), ((140, 0), vec![false; 4]));
        // Known bars coming back after full frame: 2 frames, also late.
        t.update(1, HD, HD, Some(FULL));
        t.update(1, HD, HD, Some(SCOPE));
        t.update(1, HD, HD, Some(SCOPE));
        assert_eq!((t.bars(1), t.on_cut()), ((140, 0), false));
        // A black frame keeps the bars and is no change.
        t.update(1, HD, HD, None);
        assert!(!t.on_cut());
    }

    #[test]
    fn a_late_reading_never_jumps_and_each_change_says_why() {
        let crisp = |rect: Rect| Some(Measured { rect, crisp: [true, true, false, false] });
        let mut t = CropTracker::default();
        feed(&mut t, &[Some(FULL); 3]);
        assert_eq!(t.changed(), None);
        // A screenshot's crisp reading of new bars: believed at once, but frames after the cut.
        t.update_late(1, HD, HD, crisp(SCOPE));
        assert_eq!((t.bars(1), t.changed(), t.on_cut()), ((140, 0), Some(Why::Late), false));
        // The same reading of the very frame jumps.
        let mut t = CropTracker::default();
        feed(&mut t, &[Some(FULL); 3]);
        t.update_measured(1, HD, HD, crisp(SCOPE));
        assert_eq!((t.changed(), t.on_cut()), (Some(Why::Cut), true));
        // cropdetect seeing picture in the bars on the frame it shows: a cut.
        t.update(1, HD, HD, Some(FULL));
        assert_eq!(t.changed(), Some(Why::Cut));
        // A lookahead cut says which kind, even on a black frame.
        t.cut(1, HD, [Some(140), None], Why::Window);
        t.update(1, HD, HD, None);
        assert_eq!((t.bars(1), t.changed(), t.on_cut()), ((140, 0), Some(Why::Window), true));
    }

    #[test]
    fn crop_zoom_jumps_on_cuts_and_glides_otherwise() {
        const WIN: (i64, i64) = (2000, 837);
        let fps = 1.0 / 24.0;
        let mut z = CropZoom::new(Easing::EaseOut);
        assert_eq!(z.next(1, WIN, 0.0, false, 0.0), Some(0.0), "the first value is sent");
        assert_eq!(z.next(1, WIN, 0.0, false, fps), None, "nothing new");
        // A late change: eased over several frames, each one sent.
        let sent: Vec<f64> = (2..20).filter_map(|n| z.next(1, WIN, 0.4, false, n as f64 * fps)).collect();
        assert!(sent.len() >= 8 && sent.windows(2).all(|w| w[1] > w[0]), "{sent:?}");
        assert!(sent[0] > 0.0 && sent[0] < 0.2 && *sent.last().unwrap() == 0.4, "{sent:?}");
        assert_eq!(z.next(1, WIN, 0.4, false, 1.0), None, "settled");
        // A change under 1% isn't started.
        assert_eq!(z.next(1, WIN, 0.402, false, 1.1), None);
        // On a cut: there at once.
        assert_eq!(z.next(1, WIN, 0.0, true, 1.2), Some(0.0));
        // A new file or a new window size: at once too.
        assert_eq!(z.next(2, WIN, 0.3, false, 1.3), Some(0.3));
        assert_eq!(z.next(2, (1920, 1080), 0.0, false, 1.4), Some(0.0));
        // mpv refused it: sent again.
        z.unsent();
        assert_eq!(z.next(2, (1920, 1080), 0.0, false, 1.5), Some(0.0));
    }
    #[test]
    fn opening_points_spread_over_the_first_minutes() {
        let film = opening_points(Some(5400.0), 0.0);
        assert_eq!(film.len(), OPENING_SAMPLES);
        assert_eq!((film[0], film[7]), (21.25, 178.75));
        let resumed = opening_points(Some(5400.0), 3000.0);
        assert_eq!((resumed[0], resumed[7]), (3011.25, 3168.75));
        let short = opening_points(Some(65.0), 0.0);
        assert!(short.iter().all(|t| (10.0..60.0).contains(t)), "{short:?}");
        assert!(opening_points(Some(5400.0), 5390.0).is_empty(), "too near the end");
        assert!(opening_points(Some(20.0), 0.0).is_empty());
        assert!(opening_points(None, 0.0).is_empty());
        assert!(opening_points(Some(f64::INFINITY), 0.0).is_empty());
    }

    #[test]
    fn opening_bars_need_five_crisp_readings_of_eight() {
        let m = |rect: Rect, crisp: bool| Some(Measured { rect, crisp: [crisp, crisp, false, false] });
        let full = Some(Measured { rect: FULL, crisp: [false; 4] });
        let scope_142 = Rect { w: 1920, h: 796, x: 0, y: 142 };
        assert_eq!(opening_bars(HD, &[m(SCOPE, true); 8]), (140, 0));
        // Fades don't vote, but don't stop 5 that agree; the thinnest of them is taken.
        let mut five = vec![None; 3];
        five.extend([m(scope_142, true), m(SCOPE, true), m(SCOPE, true), m(scope_142, true), m(SCOPE, true)]);
        assert_eq!(opening_bars(HD, &five), (140, 0));
        // 4 of 8: start uncropped.
        let mut four = vec![full; 4];
        four.extend([m(SCOPE, true); 4]);
        assert_eq!(opening_bars(HD, &four), (0, 0));
        // Dark shots read as bars, not crisp: never believed before playback.
        assert_eq!(opening_bars(HD, &[m(SCOPE, false); 8]), (0, 0));
        // Uneven bars aren't letterboxing; fewer readings need as large a share.
        let uneven = Rect { w: 1920, h: 860, x: 0, y: 140 };
        assert_eq!(opening_bars(HD, &[m(uneven, true); 8]), (0, 0));
        assert_eq!(opening_bars(HD, &[m(SCOPE, true), m(SCOPE, true), full]), (140, 0));
        assert_eq!(opening_bars(HD, &[m(SCOPE, true), full, full]), (0, 0));
        assert_eq!(opening_bars(HD, &[]), (0, 0));
        // A pillarbox on top: both axes.
        let boxed = Some(Measured { rect: Rect { w: 1440, h: 800, x: 240, y: 140 }, crisp: [true; 4] });
        assert_eq!(opening_bars(HD, &[boxed; 8]), (140, 240));
    }

    #[test]
    fn an_opened_tracker_shows_its_bars_from_the_first_frame() {
        let mut t = CropTracker::default();
        t.open(1, HD, (140, 0));
        assert_eq!(t.bars(1), (140, 0));
        assert_eq!(feed(&mut t, &[Some(SCOPE), None, Some(SCOPE)]), vec![(140, 0); 3]);
        // Picture in the bars: un-cropped on that frame, and the bars come back as known ones.
        assert_eq!(feed(&mut t, &[Some(FULL)]), vec![(0, 0)]);
        assert!(t.on_cut());
        assert_eq!(feed(&mut t, &[Some(SCOPE), Some(SCOPE)]), vec![(0, 0), (140, 0)]);
        // A new load starts from nothing.
        t.update(2, HD, HD, Some(SCOPE));
        assert_eq!(t.bars(2), (0, 0));
    }
}
