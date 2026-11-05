//! Autocrop: which black bars to remove, and the zoom that removes them.

use std::collections::VecDeque;

use serde_json::Value;

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
/// other shape needs [`CROP_HISTORY`].
const KNOWN_FRAMES: usize = 2;
const COMMON_FRAMES: usize = 4;
/// How far apart (pixels) readings of the same bar edge may be. A real bar's
/// edge is crisp and found on the same row every frame; dark picture content
/// fades out at a different row from one frame to the next.
const EDGE_SLACK: i64 = 4;
/// Picture shapes films and shows are made in. Bars that leave one of these
/// are believed sooner than bars that leave an odd shape.
const COMMON_ASPECTS: &[f64] = &[1.33, 1.37, 1.43, 1.5, 1.66, 1.78, 1.85, 1.9, 2.0, 2.2, 2.35, 2.39, 2.4, 2.55, 2.76];

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
    /// Bars removed now: (top and bottom, left and right).
    shown: (i64, i64),
    /// Bar thicknesses cropped earlier in this load, per axis.
    known: [Vec<i64>; 2],
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

    /// Feed one frame's reading (`None` if cropdetect had nothing).
    /// `display` is the frame's display size, for non-square pixels.
    pub fn update(&mut self, load: u64, full: (i64, i64), display: (i64, i64), reading: Option<Rect>) {
        if load != self.load || full != self.full {
            *self = CropTracker { load, full, ..Default::default() };
        }
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

        let shown = [self.shown.0, self.shown.1];
        let mut next = shown;
        for axis in 0..2 {
            if let Some(thinner) = self.revealed(axis, shown[axis]) {
                next[axis] = thinner;
            } else if let Some(bars) = self.settled(axis, shown, display) {
                next[axis] = bars;
            }
        }
        for axis in 0..2 {
            if next[axis] > shown[axis] && !self.known[axis].iter().any(|k| (k - next[axis]).abs() <= EDGE_SLACK) {
                self.known[axis].push(next[axis]);
            }
        }
        self.shown = (next[0], next[1]);
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
        let held = [KNOWN_FRAMES, COMMON_FRAMES, CROP_HISTORY]
            .into_iter()
            .take_while(|&n| {
                self.recent.len() >= n
                    && (0..2)
                        .all(|side| edge(n, side).max().unwrap_or(0) - edge(n, side).min().unwrap_or(0) <= EDGE_SLACK)
            })
            .last()?;
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
        let needed = if self.known[axis].iter().any(|k| (k - bars).abs() <= EDGE_SLACK) {
            KNOWN_FRAMES
        } else if COMMON_ASPECTS.iter().any(|c| (shape / c - 1.0).abs() <= 0.02) {
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
}
