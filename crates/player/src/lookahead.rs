//! Autocrop's lookahead (docs/autocrop.md §4): a decoder running ahead of
//! the playhead reads keyframes only, and [`Schedule`] turns what it
//! measures into bar changes due at a pts. The engine hands each one to
//! [`CropTracker::cut`](crate::crop::CropTracker::cut) on the frame with
//! that pts, so a change lands on the cut itself, where a jump can't be
//! seen. A change between keyframes is known to fall after the keyframe
//! before: within that window the first frame whose own reading shows the
//! new bars is the cut ([`Schedule::found`]).

use std::collections::VecDeque;

use crate::bars::Measured;
use crate::crop::Rect;

/// How far ahead of the playhead the lookahead reads, in seconds: inside
/// mpv's 90 s cache (`--cache-secs`), so the desktop can read from it.
pub const AHEAD_SECS: f64 = 60.0;

/// How far apart (seconds) a frame's `time-pos` and a keyframe's pts from
/// the lookahead may be and still be the same frame (a frame at 60 fps
/// lasts 16.7 ms).
pub const PTS_SLACK: f64 = 0.005;

/// How far apart (pixels) two readings of the same bar edge may be, as
/// [`crop`](crate::crop)'s `EDGE_SLACK`.
const EDGE_SLACK: i64 = 4;

/// From the frame with this pts on, these bars (top and bottom, left and
/// right, in video pixels); `None` on an axis: no change there. `after`:
/// the keyframe before, which still had the old bars, so the cut is on a
/// frame after it, up to `pts` (`None`: not known, after a seek).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Change {
    pub pts: f64,
    pub bars: [Option<i64>; 2],
    pub after: Option<f64>,
}

/// Bars a run of keyframes agrees on, per axis.
#[derive(Debug, Clone, Copy)]
struct Run {
    bars: i64,
    /// The pts of the run's first keyframe: where the bars appeared.
    from: f64,
    /// Believed: crisp on its first keyframe, or read again on a later one.
    confirmed: bool,
    /// The keyframe before `from` that read this axis.
    after: Option<f64>,
    /// No run came before it since the start or a seek.
    first: bool,
}

/// Bar changes ahead of the playhead, from keyframe readings fed in pts
/// order. A keyframe's bars on an axis count when they're even, at least
/// 1% a side (else none), and leave at least 40% of the frame; black
/// frames and uneven readings don't count either way. New bars are
/// scheduled on the keyframe they first show on, once believed: at once
/// when crisp on both sides, or when a later keyframe reads them again
/// (seconds of the same bars, far more than the live tracker waits for).
/// A change whose frame has already been shown is dropped, never applied
/// late: the live tracker handles those.
#[derive(Debug)]
pub struct Schedule {
    /// The `Mpv::loads` and frame size these readings belong to.
    load: u64,
    full: (i64, i64),
    runs: [Option<Run>; 2],
    /// The pts of the last keyframe that read each axis.
    seen: [Option<f64>; 2],
    /// The bars last scheduled per axis (`None`: none yet this load).
    last: [Option<i64>; 2],
    /// The reading [`found`](Self::found) was given for the frame before.
    live: Option<Option<Rect>>,
    /// Believed changes not yet due, by pts.
    due: VecDeque<Change>,
    /// The pts of the last keyframe read, and of the last frame shown.
    read: Option<f64>,
    shown: Option<f64>,
}

impl Schedule {
    /// A schedule for `load`, whose playback starts with `bars` removed
    /// (the pre-roll's [`opening_bars`](crate::crop::opening_bars)).
    pub fn new(load: u64, full: (i64, i64), bars: (i64, i64)) -> Self {
        Schedule {
            load,
            full,
            runs: [None; 2],
            seen: [None; 2],
            last: [Some(bars.0), Some(bars.1)],
            live: None,
            due: VecDeque::new(),
            read: None,
            shown: None,
        }
    }

    /// After a seek: forget what was read, keep the bars last scheduled
    /// (the tracker's state carries on), and read again from the new place.
    pub fn restart(&mut self) {
        (self.runs, self.seen, self.due, self.read, self.shown, self.live) =
            ([None; 2], [None; 2], VecDeque::new(), None, None, None);
    }

    /// The pts of the last keyframe read, if any since the start or a seek.
    pub fn read_to(&self) -> Option<f64> {
        self.read
    }

    /// Whether the lookahead should read further, with the playhead at `playhead`.
    pub fn wants_more(&self, playhead: f64) -> bool {
        self.read.is_none_or(|r| r < playhead + AHEAD_SECS)
    }

    /// The changes believed so far and not yet due.
    pub fn pending(&self) -> impl Iterator<Item = &Change> {
        self.due.iter()
    }

    /// Feed the keyframe at `pts` as our own detector measured it, scaled
    /// to the video's pixels (`None`: a black frame). Keyframes come in pts
    /// order; one at or before the last read is ignored.
    pub fn keyframe(&mut self, load: u64, pts: f64, measured: Option<Measured>) {
        if load != self.load || self.read.is_some_and(|r| pts <= r + PTS_SLACK) {
            return;
        }
        self.read = Some(pts);
        let Some(m) = measured else { return };
        let readings = self.readings(m);
        for (axis, reading) in readings.into_iter().enumerate() {
            let Some((bars, crisp)) = reading else { continue };
            let after = self.seen[axis].replace(pts);
            match &mut self.runs[axis] {
                Some(run) if (run.bars - bars).abs() <= EDGE_SLACK => {
                    let (from, bars, first) = (run.from, run.bars.min(bars), run.first);
                    if !run.confirmed {
                        run.confirmed = true;
                        let earlier = run.after;
                        self.schedule(axis, from, bars, earlier, first);
                    }
                    // The same bars again: due here too, in case a shot
                    // with no keyframe came in between and live changed them.
                    self.schedule(axis, pts, bars, after, false);
                }
                run => {
                    let first = run.is_none();
                    *run = Some(Run { bars, from: pts, confirmed: crisp, after, first });
                    if crisp {
                        self.schedule(axis, pts, bars, after, first);
                    }
                }
            }
        }
    }

    /// The change to apply on the frame with `pts`, about to be shown, if
    /// one is due on it. Changes due on frames already shown are dropped.
    pub fn take(&mut self, load: u64, pts: f64) -> Option<Change> {
        if load != self.load {
            return None;
        }
        let shown = self.shown.replace(pts);
        let mut now = None;
        while let Some(c) = self.due.front().filter(|c| c.pts <= pts + PTS_SLACK) {
            if shown.is_none_or(|s| c.pts > s + PTS_SLACK) {
                now = Some(*c);
            }
            self.due.pop_front();
        }
        now
    }

    /// After [`take`](Self::take), for every frame: the next change, if
    /// this frame lies between the keyframe before it and its own, and
    /// `live`, this frame's own reading (cropdetect's, of this very frame),
    /// shows its bars where the frame before didn't. That frame is the cut;
    /// the change is applied there and no longer due on its keyframe.
    pub fn found(&mut self, load: u64, pts: f64, live: Option<Rect>) -> Option<Change> {
        let before = self.live.replace(live).flatten();
        let c = *self.due.front().filter(|_| load == self.load)?;
        let after = c.after?;
        if pts <= after + PTS_SLACK || pts >= c.pts - PTS_SLACK {
            return None;
        }
        let shows = |r: Option<Rect>| {
            let Some(r) = r else { return false };
            let reading = self.readings(Measured { rect: r, crisp: [false; 4] });
            (0..2).all(|axis| {
                c.bars[axis].is_none_or(|b| reading[axis].is_some_and(|(live, _)| (live - b).abs() <= EDGE_SLACK))
            })
        };
        (shows(live) && !shows(before)).then(|| self.due.pop_front()).flatten()
    }

    /// Per axis: the keyframe's bars and whether they're crisp on both
    /// sides, or `None` where they don't count.
    fn readings(&self, m: Measured) -> [Option<(i64, bool)>; 2] {
        let (fw, fh) = self.full;
        let r = m.rect;
        if r.w <= 0 || r.h <= 0 || r.x < 0 || r.y < 0 || r.x + r.w > fw || r.y + r.h > fh {
            return [None; 2];
        }
        let axis = |axis: usize| {
            let dim = if axis == 0 { fh } else { fw };
            let (a, b) = if axis == 0 { (r.y, fh - r.y - r.h) } else { (r.x, fw - r.x - r.w) };
            if a.max(b) * 100 < dim {
                return Some((0, true)); // picture to the edges
            }
            let even = ((dim as f64 * 0.02).round() as i64).max(EDGE_SLACK);
            ((a - b).abs() <= even && a.min(b) * 100 >= dim)
                .then_some((a.min(b), m.crisp[2 * axis] && m.crisp[2 * axis + 1]))
        };
        let both = [axis(0), axis(1)];
        let (v, h) = (both[0].map_or(0, |b| b.0), both[1].map_or(0, |b| b.0));
        if (fw - 2 * h) * (fh - 2 * v) * 10 < fw * fh * 4 {
            return [None; 2];
        }
        both
    }

    /// Every believed keyframe's bars are scheduled, even bars scheduled
    /// before: the live tracker may have changed them in between (a shot
    /// with no keyframe), and [`CropTracker::cut`](crate::crop::CropTracker::cut)
    /// leaves bars already shown alone. Only those of the first run since
    /// the start or a seek are skipped when they're the bars last scheduled.
    fn schedule(&mut self, axis: usize, pts: f64, bars: i64, after: Option<f64>, first: bool) {
        if first && self.last[axis].is_some_and(|l| (l - bars).abs() <= EDGE_SLACK) {
            return;
        }
        self.last[axis] = Some(bars);
        let at = self.due.iter().position(|c| c.pts > pts - PTS_SLACK).unwrap_or(self.due.len());
        match self.due.get_mut(at).filter(|c| (c.pts - pts).abs() <= PTS_SLACK) {
            Some(c) => {
                c.bars[axis] = Some(bars);
                // Both axes changed here: the cut is after both keyframes before.
                c.after = c.after.zip(after).map(|(a, b)| a.max(b));
            }
            None => {
                let mut c = Change { pts, bars: [None; 2], after };
                c.bars[axis] = Some(bars);
                self.due.insert(at, c);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crop::{CropTracker, Rect, Why};

    const HD: (i64, i64) = (1920, 1080);

    /// A keyframe with `v` px bars top and bottom, crisp or not.
    fn bars(v: i64, crisp: bool) -> Option<Measured> {
        Some(Measured { rect: Rect { w: 1920, h: 1080 - 2 * v, x: 0, y: v }, crisp: [crisp, crisp, false, false] })
    }

    #[test]
    fn crisp_new_bars_are_due_on_their_keyframe() {
        let mut s = Schedule::new(1, HD, (0, 0));
        s.keyframe(1, 2.0, bars(0, false));
        s.keyframe(1, 4.5, bars(140, true));
        // The sides read full frame again: due there too, as a re-read.
        let at = Change { pts: 4.5, bars: [Some(140), Some(0)], after: Some(2.0) };
        assert_eq!(s.pending().collect::<Vec<_>>(), [&at]);
        assert_eq!(s.take(1, 4.4583), None);
        assert_eq!(s.take(1, 4.5), Some(at));
        assert_eq!(s.take(1, 4.5417), None);
    }

    #[test]
    fn unclear_bars_wait_for_a_second_keyframe() {
        let mut s = Schedule::new(1, HD, (0, 0));
        s.keyframe(1, 4.5, bars(142, false));
        assert_eq!(s.pending().count(), 0);
        s.keyframe(1, 6.0, None); // a fade says nothing
        s.keyframe(1, 8.0, bars(140, false));
        assert_eq!(s.pending().next(), Some(&Change { pts: 4.5, bars: [Some(140), None], after: None }));
        // The same bars read again are due on their keyframes too: a shot
        // with no keyframe in between may have changed them live.
        s.keyframe(1, 10.0, bars(140, true));
        let due: Vec<_> = s.pending().map(|c| (c.pts, c.bars[0], c.after)).collect();
        assert_eq!(due, [(4.5, Some(140), None), (8.0, Some(140), Some(4.5)), (10.0, Some(140), Some(8.0))]);
    }

    #[test]
    fn known_bars_and_odd_readings_schedule_nothing() {
        let mut s = Schedule::new(1, HD, (140, 0));
        s.keyframe(1, 1.0, bars(140, true));
        // Uneven: a dark shot lit at the bottom.
        let uneven = Measured { rect: Rect { w: 1920, h: 700, x: 0, y: 300 }, crisp: [true; 4] };
        s.keyframe(1, 2.0, Some(uneven));
        s.keyframe(1, 3.0, Some(uneven));
        // Less than 40% of the frame left.
        s.keyframe(1, 4.0, bars(400, true));
        // Out of order.
        s.keyframe(1, 0.5, bars(0, true));
        // Another load.
        s.keyframe(2, 5.0, bars(0, true));
        // Only the sides, read full frame again.
        assert!(s.pending().all(|c| c.bars == [None, Some(0)]), "{:?}", s.pending().collect::<Vec<_>>());
    }

    #[test]
    fn back_to_full_frame_and_both_axes_on_one_cut() {
        let mut s = Schedule::new(1, HD, (140, 0));
        s.keyframe(1, 3.0, bars(0, false));
        let boxed = Measured { rect: Rect { w: 1440, h: 800, x: 240, y: 140 }, crisp: [true; 4] };
        s.keyframe(1, 7.0, Some(boxed));
        let due: Vec<_> = s.pending().copied().collect();
        assert_eq!(
            due,
            [
                Change { pts: 3.0, bars: [Some(0), None], after: None },
                Change { pts: 7.0, bars: [Some(140), Some(240)], after: Some(3.0) }
            ]
        );
    }

    #[test]
    fn a_change_already_past_is_dropped_not_applied_late() {
        let mut s = Schedule::new(1, HD, (0, 0));
        s.take(1, 4.0);
        s.take(1, 5.0);
        s.keyframe(1, 4.5, bars(140, false));
        s.keyframe(1, 8.0, bars(140, false)); // believed only now, after 4.5 was shown
        assert_eq!(s.pending().map(|c| c.pts).collect::<Vec<_>>(), [4.5, 8.0]);
        assert_eq!(s.take(1, 5.0417), None);
        assert_eq!(s.pending().map(|c| c.pts).collect::<Vec<_>>(), [8.0], "the re-read on 8.0 is still due");
    }

    #[test]
    fn a_seek_reads_again_from_the_new_place() {
        let mut s = Schedule::new(1, HD, (0, 0));
        s.keyframe(1, 30.0, bars(140, true));
        assert!(s.wants_more(0.0));
        s.keyframe(1, 61.0, bars(140, true));
        assert!(!s.wants_more(0.5));
        s.restart();
        assert_eq!((s.pending().count(), s.read_to()), (0, None));
        // Bars scheduled before the seek still count as the bars shown.
        s.keyframe(1, 20.0, bars(140, true));
        assert_eq!(s.pending().count(), 0);
        // A seek that lands on the keyframe of a change applies it there.
        s.keyframe(1, 25.0, bars(0, true));
        assert_eq!(s.take(1, 25.0), Some(Change { pts: 25.0, bars: [Some(0), Some(0)], after: Some(20.0) }));
    }

    #[test]
    fn a_change_between_keyframes_lands_where_the_live_reading_shows_it() {
        let mut s = Schedule::new(1, HD, (0, 0));
        s.keyframe(1, 0.0, bars(0, true));
        s.keyframe(1, 10.0, bars(140, true)); // the cut is somewhere after 0.0
        let scope = Some(Rect { w: 1920, h: 800, x: 0, y: 140 });
        let full = Some(Rect { w: 1920, h: 1080, x: 0, y: 0 });
        assert_eq!(s.take(1, 0.0), None);
        assert_eq!(s.found(1, 0.0, scope), None, "not after the keyframe before");
        assert_eq!(s.take(1, 3.0), None);
        assert_eq!(s.found(1, 3.0, full), None, "old bars still");
        assert_eq!(s.found(1, 3.0, None), None, "a black frame says nothing");
        let thicker = Some(Rect { w: 1920, h: 700, x: 0, y: 190 });
        assert_eq!(s.found(1, 3.0, thicker), None, "other bars");
        let at = Change { pts: 10.0, bars: [Some(140), Some(0)], after: Some(0.0) };
        assert_eq!(s.found(1, 3.0417, scope), Some(at));
        // Applied there: not again on its keyframe.
        assert_eq!(s.take(1, 10.0), None);
        // Unknown window (the first keyframe after a seek): only on its keyframe.
        s.restart();
        s.keyframe(1, 20.0, bars(0, true));
        assert_eq!(s.found(1, 19.0, full), None);
        assert_eq!(s.take(1, 20.0).map(|c| c.after), Some(None));
    }

    /// Where an invented episode's keyframes are.
    #[derive(Clone, Copy)]
    enum Gop {
        /// As x264/x265 place them with a 250-frame keyint: on every cut,
        /// except one less than 24 frames (min-keyint) after the last
        /// keyframe, i.e. right after a short shot; at least every 250 frames.
        Encoder,
        /// Only on every other cut (and every 250 frames): about half the
        /// shots have no keyframe of their own.
        EveryOtherCut,
    }

    /// An invented episode at 24 fps: 120 shots, each full frame or
    /// letterboxed (2.40:1 or 2.20:1) unlike the one before, of 40 to 200
    /// frames, every eighth a short one of 8 to 20. Each frame's bars, which
    /// frames are keyframes, and the cuts.
    fn episode(gop: Gop) -> (Vec<i64>, Vec<bool>, Vec<usize>) {
        let mut seed = 7u32;
        let mut rnd = |n: u32| {
            seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
            (seed >> 16) % n
        };
        let (mut frames, mut cuts, mut bars) = (Vec::new(), Vec::new(), 0);
        for shot in 0..120 {
            if shot > 0 {
                cuts.push(frames.len());
                bars = [0, 140, 100].into_iter().filter(|&b| b != bars).nth(rnd(2) as usize).unwrap();
            }
            let len = if shot % 8 == 7 { 8 + rnd(13) } else { 40 + rnd(161) } as usize;
            frames.extend(std::iter::repeat_n(bars, len));
        }
        let mut key = vec![false; frames.len()];
        let mut last = 0;
        for (i, k) in key.iter_mut().enumerate() {
            let cut = cuts.iter().position(|&c| c == i);
            let on_cut = match gop {
                Gop::Encoder => cut.is_some() && i - last >= 24,
                Gop::EveryOtherCut => cut.is_some_and(|n| n % 2 == 1),
            };
            if i == 0 || on_cut || i - last >= 250 {
                (*k, last) = (true, i);
            }
        }
        (frames, key, cuts)
    }

    /// Play an [`episode`] through the desktop engine's default path
    /// (cropdetect on every frame; a screenshot for our detector when its
    /// reading changes, back 2 frames later), with the lookahead or without.
    /// The share of the cuts whose bars change on the cut frame and jump there.
    fn landed_on_cut(gop: Gop, lookahead: bool) -> f64 {
        use crate::sampler::{Feed, Sampler, Sampling};
        let (frames, key, cuts) = episode(gop);
        let f = 1.0 / 24.0;
        let rect = |b: i64| Rect { w: 1920, h: 1080 - 2 * b, x: 0, y: b };
        let ours = |b: i64| Some(Measured { rect: rect(b), crisp: [b > 0, b > 0, false, false] });
        let mut t = CropTracker::default();
        t.open(1, HD, (0, 0));
        let mut s = Schedule::new(1, HD, (0, 0));
        let mut sampler = Sampler::new(Sampling::AroundChanges);
        let mut read = 0; // keyframes read by the lookahead so far
        let mut shot: Option<(usize, i64)> = None; // a screenshot's arrival frame and bars
        let mut on_cut = Vec::new();
        for (i, &b) in frames.iter().enumerate() {
            let pts = i as f64 * f;
            while lookahead && read < frames.len() && (read as f64 * f) < pts + AHEAD_SECS {
                if key[read] {
                    s.keyframe(1, read as f64 * f, bars(frames[read], frames[read] > 0));
                }
                read += 1;
            }
            let live = Some(rect(b));
            let due = s.take(1, pts).map(|c| (c, Why::Keyframe));
            if let Some((c, why)) = due.or(s.found(1, pts, live).map(|c| (c, Why::Window))) {
                t.cut(1, HD, c.bars, why);
            }
            if let Some((_, bars)) = shot.filter(|(at, _)| *at == i) {
                sampler.measured(ours(bars));
                shot = None;
            }
            match sampler.frame(live, t.following()) {
                Feed::Cropdetect(r) => t.update(1, HD, HD, r),
                Feed::Measured(m) => t.update_late(1, HD, HD, m),
                Feed::Wait => t.update(1, HD, HD, None),
            }
            if sampler.wants_shot() && shot.is_none() {
                shot = Some((i + 2, b));
            }
            if cuts.contains(&i) {
                on_cut.push(t.bars(1).0 == b && t.on_cut());
            }
        }
        on_cut.iter().filter(|&&l| l).count() as f64 / on_cut.len() as f64
    }

    #[test]
    fn with_the_lookahead_changes_land_on_their_cut() {
        let (_, key, cuts) = episode(Gop::Encoder);
        let off_keyframes = cuts.iter().filter(|&&c| !key[c]).count();
        assert!(off_keyframes * 10 >= cuts.len(), "a tenth or more of the cuts aren't keyframes: {off_keyframes}");
        let (on, off) = (landed_on_cut(Gop::Encoder, true), landed_on_cut(Gop::Encoder, false));
        assert!(on >= 0.9, "with the lookahead: {on}");
        assert!(off < on - 0.3, "without: {off}, with: {on}");
        // Shots with no keyframe whose bars differ from both neighbours are
        // left to the live detector: fewer land, but still far more than without.
        let (on, off) = (landed_on_cut(Gop::EveryOtherCut, true), landed_on_cut(Gop::EveryOtherCut, false));
        assert!(on >= 0.85 && off < on - 0.3, "every other cut a keyframe: {on} with, {off} without");
    }

    /// Feed a frame to the tracker the way the engine does: the change due
    /// on it first, then its live reading. The bars and whether the zoom jumps.
    fn frame(t: &mut CropTracker, s: &mut Schedule, pts: f64, live: Option<Measured>) -> ((i64, i64), bool) {
        if let Some(c) = s.take(1, pts) {
            t.cut(1, HD, c.bars, Why::Keyframe);
        }
        t.update_measured(1, HD, HD, live);
        (t.bars(1), t.on_cut())
    }

    #[test]
    fn the_tracker_jumps_on_the_cut_frame() {
        let mut t = CropTracker::default();
        t.open(1, HD, (0, 0));
        let mut s = Schedule::new(1, HD, (0, 0));
        // An odd shape in a dark shot: live alone waits 12 frames.
        let odd = |crisp| bars(170, crisp);
        s.keyframe(1, 4.0, odd(false));
        s.keyframe(1, 6.0, odd(false));
        let f = 1.0 / 24.0;
        assert_eq!(frame(&mut t, &mut s, 4.0 - f, bars(0, false)), ((0, 0), false));
        assert_eq!(frame(&mut t, &mut s, 4.0, odd(false)), ((170, 0), true));
        assert_eq!(frame(&mut t, &mut s, 4.0 + f, odd(false)), ((170, 0), false));
        // A black frame on the cut keeps the jump.
        s.keyframe(1, 9.0, bars(0, true));
        frame(&mut t, &mut s, 9.0 - f, odd(false));
        assert_eq!(frame(&mut t, &mut s, 9.0, None), ((0, 0), true));
    }

    #[test]
    fn picture_in_scheduled_bars_still_uncrops_at_once() {
        let mut t = CropTracker::default();
        t.open(1, HD, (0, 0));
        let mut s = Schedule::new(1, HD, (0, 0));
        s.keyframe(1, 4.0, bars(140, true));
        assert_eq!(frame(&mut t, &mut s, 4.0, bars(0, false)), ((0, 0), true));
    }

    #[test]
    fn bars_already_on_the_frame_before_were_no_cut() {
        // The bars changed between keyframes: live saw them first, so the
        // keyframe isn't where they changed and nothing jumps there.
        let mut t = CropTracker::default();
        t.open(1, HD, (0, 0));
        let mut s = Schedule::new(1, HD, (0, 0));
        s.keyframe(1, 4.0, bars(170, false));
        s.keyframe(1, 6.0, bars(170, false));
        let f = 1.0 / 24.0;
        frame(&mut t, &mut s, 4.0 - 2.0 * f, bars(170, false));
        frame(&mut t, &mut s, 4.0 - f, bars(170, false));
        assert_eq!(frame(&mut t, &mut s, 4.0, bars(170, false)), ((0, 0), false));
    }
}
