//! Which reading of each frame goes to [`CropTracker`](crate::crop::CropTracker)
//! on the desktop, where our detector ([`crate::bars`]) needs a screenshot
//! of the frame and cropdetect reads every frame inside mpv
//! (docs/autocrop.md §2, "Our detector on the desktop").
//!
//! * [`Sampling::AroundChanges`] (Windows and Linux, the default):
//!   cropdetect's reading feeds each frame, and when it changes a
//!   screenshot is taken for our detector, then more while the bars keep
//!   moving or the tracker follows them, until our readings hold still.
//!   Meanwhile only our readings feed the tracker, so its crisp edges and
//!   follow mode work as on every frame.
//! * [`Sampling::EveryFrame`] (macOS, where libmpv hands frames over in
//!   memory, and the opt-in setting elsewhere): a screenshot of each frame,
//!   one at a time, and no cropdetect.
//!
//! A screenshot is of the frame on screen and arrives a frame or two after
//! it was asked for, so a change it finds lands that much after its cut.

use crate::bars::Measured;
use crate::crop::Rect;

/// How the desktop engine reads the bars.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Sampling {
    AroundChanges,
    EveryFrame,
}

/// What to hand the tracker for this frame.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Feed {
    /// cropdetect's reading ([`CropTracker::update`](crate::crop::CropTracker::update)).
    Cropdetect(Option<Rect>),
    /// Our detector's ([`CropTracker::update_measured`](crate::crop::CropTracker::update_measured)).
    Measured(Option<Measured>),
    /// Nothing: a screenshot is on its way.
    Wait,
}

/// Our readings in a row that must agree, with the tracker not following,
/// before [`Sampling::AroundChanges`] goes back to cropdetect.
pub const STILL_SHOTS: usize = 3;
/// Frames without a screenshot after which [`Sampling::AroundChanges`] gives
/// up on it and goes back to cropdetect (a screenshot failed or is slow).
pub const SHOT_WAIT_FRAMES: usize = 12;
/// Edges within this many pixels count as the same.
const SLACK: i64 = 4;

#[derive(Debug, Clone)]
pub struct Sampler {
    sampling: Sampling,
    /// Taking screenshots now ([`Sampling::AroundChanges`]).
    active: bool,
    /// cropdetect's reading of the frame before.
    last_reading: Option<Rect>,
    /// A screenshot's reading not yet fed (`Some(None)`: a black frame).
    pending: Option<Option<Measured>>,
    /// The last reading of ours fed, and how many in a row agreed with it.
    last_measured: Option<Option<Rect>>,
    still: usize,
    /// Frames since the last screenshot's reading came.
    waited: usize,
}

impl Sampler {
    pub fn new(sampling: Sampling) -> Self {
        Sampler { sampling, active: false, last_reading: None, pending: None, last_measured: None, still: 0, waited: 0 }
    }

    pub fn sampling(&self) -> Sampling {
        self.sampling
    }

    /// Whether a screenshot should be on its way now (the engine keeps one
    /// at a time).
    pub fn wants_shot(&self) -> bool {
        self.sampling == Sampling::EveryFrame || self.active
    }

    /// A screenshot's reading came (`None`: a black frame).
    pub fn measured(&mut self, measured: Option<Measured>) {
        self.pending = Some(measured);
    }

    /// Start afresh (a new file, a seek): the readings before say nothing.
    pub fn reset(&mut self) {
        *self = Sampler::new(self.sampling);
    }

    /// One displayed frame: cropdetect's reading of it (none with
    /// [`Sampling::EveryFrame`]) and whether the tracker follows animated
    /// bars. Says what the tracker gets.
    pub fn frame(&mut self, reading: Option<Rect>, following: bool) -> Feed {
        let changed = !same_rect(self.last_reading, reading);
        self.last_reading = reading;
        if let Some(m) = self.pending.take() {
            self.waited = 0;
            let rect = m.map(|m| m.rect);
            let agrees = self.last_measured.is_some_and(|last| same_rect(last, rect));
            self.still = if agrees && !following { self.still + 1 } else { 0 };
            self.last_measured = Some(rect);
            if self.sampling == Sampling::AroundChanges && self.still + 1 >= STILL_SHOTS {
                self.stop();
            }
            return Feed::Measured(m);
        }
        match self.sampling {
            Sampling::EveryFrame => Feed::Wait,
            Sampling::AroundChanges if self.active => {
                self.waited += 1;
                if self.waited < SHOT_WAIT_FRAMES {
                    return Feed::Wait;
                }
                self.stop();
                Feed::Cropdetect(reading)
            }
            Sampling::AroundChanges if changed => {
                // The changed frame waits for our reading of it.
                self.active = true;
                Feed::Wait
            }
            Sampling::AroundChanges => Feed::Cropdetect(reading),
        }
    }

    fn stop(&mut self) {
        (self.active, self.last_measured, self.still, self.waited) = (false, None, 0, 0);
    }
}

fn same_rect(a: Option<Rect>, b: Option<Rect>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => {
            (a.x - b.x).abs() <= SLACK
                && (a.y - b.y).abs() <= SLACK
                && (a.x + a.w - b.x - b.w).abs() <= SLACK
                && (a.y + a.h - b.y - b.h).abs() <= SLACK
        }
        (None, None) => true,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rect(bars: i64) -> Rect {
        Rect { w: 1920, h: 1080 - 2 * bars, x: 0, y: bars }
    }

    fn ours(bars: i64) -> Measured {
        Measured { rect: rect(bars), crisp: [true, true, false, false] }
    }

    /// A sampler past a file's first frame (a change from no reading, so
    /// read by our detector too) and back on cropdetect.
    fn settled() -> Sampler {
        let mut s = Sampler::new(Sampling::AroundChanges);
        assert_eq!(s.frame(Some(rect(0)), false), Feed::Wait);
        for _ in 0..STILL_SHOTS {
            s.measured(Some(ours(0)));
            assert_eq!(s.frame(Some(rect(0)), false), Feed::Measured(Some(ours(0))));
        }
        assert!(!s.wants_shot());
        s
    }

    #[test]
    fn cropdetect_feeds_until_its_reading_changes() {
        let mut s = settled();
        assert_eq!(s.frame(Some(rect(0)), false), Feed::Cropdetect(Some(rect(0))));
        assert!(!s.wants_shot());
        // Within the slack: no change.
        assert_eq!(s.frame(Some(rect(2)), false), Feed::Cropdetect(Some(rect(2))));
        assert!(!s.wants_shot());
        assert_eq!(s.frame(Some(rect(140)), false), Feed::Wait);
        assert!(s.wants_shot());
    }

    #[test]
    fn our_readings_feed_until_they_hold_still() {
        let mut s = settled();
        s.frame(Some(rect(140)), false);
        assert_eq!(s.frame(Some(rect(140)), false), Feed::Wait);
        s.measured(Some(ours(138)));
        assert_eq!(s.frame(Some(rect(140)), false), Feed::Measured(Some(ours(138))));
        assert_eq!(s.frame(Some(rect(140)), false), Feed::Wait, "cropdetect waits while ours are taken");
        s.measured(Some(ours(138)));
        assert_eq!(s.frame(Some(rect(140)), false), Feed::Measured(Some(ours(138))));
        assert!(s.wants_shot());
        s.measured(Some(ours(138)));
        assert_eq!(s.frame(Some(rect(140)), false), Feed::Measured(Some(ours(138))));
        assert!(!s.wants_shot(), "{STILL_SHOTS} agreeing readings: back to cropdetect");
        assert_eq!(s.frame(Some(rect(140)), false), Feed::Cropdetect(Some(rect(140))));
    }

    #[test]
    fn moving_or_followed_bars_keep_the_screenshots_coming() {
        let mut s = settled();
        s.frame(Some(rect(100)), false);
        for (i, bars) in [100, 104, 110, 116, 122, 128].into_iter().enumerate() {
            s.measured(Some(ours(bars)));
            assert_eq!(s.frame(Some(rect(bars)), false), Feed::Measured(Some(ours(bars))));
            assert!(s.wants_shot(), "moving, reading {i}");
        }
        for _ in 0..5 {
            s.measured(Some(ours(128)));
            s.frame(Some(rect(128)), true);
            assert!(s.wants_shot(), "the tracker still follows");
        }
    }

    #[test]
    fn a_screenshot_that_never_comes_gives_way_to_cropdetect() {
        let mut s = settled();
        s.frame(Some(rect(140)), false);
        for _ in 1..SHOT_WAIT_FRAMES {
            assert_eq!(s.frame(Some(rect(140)), false), Feed::Wait);
        }
        assert_eq!(s.frame(Some(rect(140)), false), Feed::Cropdetect(Some(rect(140))));
        assert!(!s.wants_shot());
    }

    #[test]
    fn every_frame_feeds_only_our_readings() {
        let mut s = Sampler::new(Sampling::EveryFrame);
        assert!(s.wants_shot());
        assert_eq!(s.frame(None, false), Feed::Wait);
        s.measured(None);
        assert_eq!(s.frame(None, false), Feed::Measured(None), "a black frame");
        for _ in 0..10 {
            s.measured(Some(ours(140)));
            assert_eq!(s.frame(None, false), Feed::Measured(Some(ours(140))));
            assert!(s.wants_shot());
        }
        assert_eq!(s.frame(None, false), Feed::Wait);
    }

    #[test]
    fn reset_forgets_the_readings_before() {
        let mut s = settled();
        s.frame(Some(rect(140)), false);
        s.measured(Some(ours(140)));
        s.reset();
        assert!(!s.wants_shot());
        assert_eq!(
            s.frame(Some(rect(140)), false),
            Feed::Wait,
            "the first reading after a reset is a change from none"
        );
        assert_eq!(s.sampling(), Sampling::AroundChanges);
    }
}
