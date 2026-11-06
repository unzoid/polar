//! Autocrop's lookahead (docs/autocrop.md §4): a decoder running ahead of
//! the playhead reads keyframes only, and [`Schedule`] turns what it
//! measures into bar changes due at a pts. The engine hands each one to
//! [`CropTracker::cut`](crate::crop::CropTracker::cut) on the frame with
//! that pts, so a change lands on the cut itself, where a jump can't be
//! seen. Changes between keyframes are left to the live detector.

use std::collections::VecDeque;

use crate::bars::Measured;

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
/// right, in video pixels); `None` on an axis: no change there.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Change {
    pub pts: f64,
    pub bars: [Option<i64>; 2],
}

/// Bars a run of keyframes agrees on, per axis.
#[derive(Debug, Clone, Copy)]
struct Run {
    bars: i64,
    /// The pts of the run's first keyframe: where the bars appeared.
    from: f64,
    /// Believed: crisp on its first keyframe, or read again on a later one.
    confirmed: bool,
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
    /// The bars last scheduled per axis (`None`: none yet this load).
    last: [Option<i64>; 2],
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
            last: [Some(bars.0), Some(bars.1)],
            due: VecDeque::new(),
            read: None,
            shown: None,
        }
    }

    /// After a seek: forget what was read, keep the bars last scheduled
    /// (the tracker's state carries on), and read again from the new place.
    pub fn restart(&mut self) {
        (self.runs, self.due, self.read, self.shown) = ([None; 2], VecDeque::new(), None, None);
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
            match &mut self.runs[axis] {
                Some(run) if (run.bars - bars).abs() <= EDGE_SLACK => {
                    if !run.confirmed {
                        run.confirmed = true;
                        let (from, bars) = (run.from, run.bars.min(bars));
                        self.schedule(axis, from, bars);
                    }
                }
                run => {
                    *run = Some(Run { bars, from: pts, confirmed: crisp });
                    if crisp {
                        self.schedule(axis, pts, bars);
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

    fn schedule(&mut self, axis: usize, pts: f64, bars: i64) {
        if self.last[axis].is_some_and(|l| (l - bars).abs() <= EDGE_SLACK) {
            return;
        }
        self.last[axis] = Some(bars);
        let at = self.due.iter().position(|c| c.pts > pts - PTS_SLACK).unwrap_or(self.due.len());
        match self.due.get_mut(at).filter(|c| (c.pts - pts).abs() <= PTS_SLACK) {
            Some(c) => c.bars[axis] = Some(bars),
            None => {
                let mut c = Change { pts, bars: [None; 2] };
                c.bars[axis] = Some(bars);
                self.due.insert(at, c);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crop::{CropTracker, Rect};

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
        let at = Change { pts: 4.5, bars: [Some(140), None] };
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
        assert_eq!(s.pending().collect::<Vec<_>>(), [&Change { pts: 4.5, bars: [Some(140), None] }]);
        // The same bars read again schedule nothing more.
        s.keyframe(1, 10.0, bars(140, true));
        assert_eq!(s.pending().count(), 1);
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
        assert_eq!(s.pending().count(), 0);
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
            [Change { pts: 3.0, bars: [Some(0), None] }, Change { pts: 7.0, bars: [Some(140), Some(240)] }]
        );
    }

    #[test]
    fn a_change_already_past_is_dropped_not_applied_late() {
        let mut s = Schedule::new(1, HD, (0, 0));
        s.take(1, 4.0);
        s.take(1, 5.0);
        s.keyframe(1, 4.5, bars(140, false));
        s.keyframe(1, 8.0, bars(140, false)); // believed only now, after 4.5 was shown
        assert_eq!(s.pending().count(), 1);
        assert_eq!(s.take(1, 5.0417), None);
        assert_eq!(s.pending().count(), 0);
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
        assert_eq!(s.take(1, 25.0), Some(Change { pts: 25.0, bars: [Some(0), None] }));
    }

    /// Feed a frame to the tracker the way the engine does: the change due
    /// on it first, then its live reading. The bars and whether the zoom jumps.
    fn frame(t: &mut CropTracker, s: &mut Schedule, pts: f64, live: Option<Measured>) -> ((i64, i64), bool) {
        if let Some(c) = s.take(1, pts) {
            t.cut(1, HD, c.bars);
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
