//! Polarity's own black-bar detector: where the picture starts on each side
//! of one decoded frame.
//!
//! For builds whose FFmpeg has no GPL parts, and so no `cropdetect` filter
//! (the iOS build, docs/plan-mobile.md §7). It is an independent
//! implementation, written from the idea of letterbox detection (bars are
//! lines with no lit pixels, running in from the frame's edge) and not from
//! FFmpeg's `vf_cropdetect.c`, whose code it neither copies nor follows; keep
//! it that way when changing it, so this file stays MIT like the rest.
//!
//! What it adds over a per-frame reading: each edge says whether it is
//! *crisp* (picture with plenty of light starts right after the bar), which
//! [`CropTracker::update_measured`](crate::crop::CropTracker::update_measured)
//! takes as leave to crop sooner. Dark picture next to a bar fades out over
//! several lines, at a different line every frame, and isn't crisp.

use crate::crop::Rect;

/// How a [`Frame`]'s bytes are laid out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PixelFormat {
    /// One byte of luma per pixel (FFmpeg's `gray`).
    Luma8,
    /// Blue, green, red and a byte of padding per pixel: mpv's
    /// `screenshot-raw` (format `bgr0`).
    Bgr0,
    /// Red, green and blue, a byte each: a PNG screenshot ([`crate::png`]).
    Rgb8,
}

/// One decoded frame, borrowed.
#[derive(Debug, Clone, Copy)]
pub struct Frame<'a> {
    pub w: usize,
    pub h: usize,
    /// Bytes from the start of one line to the start of the next.
    pub stride: usize,
    pub format: PixelFormat,
    pub data: &'a [u8],
}

impl Frame<'_> {
    fn fits(&self) -> bool {
        let bytes = match self.format {
            PixelFormat::Luma8 => 1,
            PixelFormat::Bgr0 => 4,
            PixelFormat::Rgb8 => 3,
        };
        self.w > 0
            && self.h > 0
            && self.stride >= self.w * bytes
            && self
                .stride
                .checked_mul(self.h - 1)
                .and_then(|s| s.checked_add(self.w * bytes))
                .is_some_and(|n| n <= self.data.len())
    }

    /// Luma of the pixel at (`x`, `y`), 0-255 (BT.709 weights for BGR).
    fn luma(&self, x: usize, y: usize) -> u8 {
        match self.format {
            PixelFormat::Luma8 => self.data[y * self.stride + x],
            PixelFormat::Bgr0 => {
                let p = &self.data[y * self.stride + x * 4..][..3];
                ((u32::from(p[2]) * 54 + u32::from(p[1]) * 183 + u32::from(p[0]) * 19) >> 8) as u8
            }
            PixelFormat::Rgb8 => {
                let p = &self.data[y * self.stride + x * 3..][..3];
                ((u32::from(p[0]) * 54 + u32::from(p[1]) * 183 + u32::from(p[2]) * 19) >> 8) as u8
            }
        }
    }
}

/// One frame's bars as [`detect`] sees them.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Measured {
    /// The picture inside the bars, in the frame's pixels.
    pub rect: Rect,
    /// Whether each edge is a crisp bar, `[top, bottom, left, right]`: a
    /// bar is there, and well-lit picture starts within [`CRISP_LINES`].
    pub crisp: [bool; 4],
}

impl Measured {
    /// The same reading in a frame of size `to`, measured in one of size
    /// `from`: a screenshot is scaled to the display shape, while the
    /// tracker counts in the video's own pixels.
    pub fn scaled(self, from: (i64, i64), to: (i64, i64)) -> Measured {
        if from == to || from.0 <= 0 || from.1 <= 0 {
            return self;
        }
        let at = |v: i64, f: i64, t: i64| (v * t + f / 2) / f;
        let r = self.rect;
        let (x0, x1) = (at(r.x, from.0, to.0), at(r.x + r.w, from.0, to.0));
        let (y0, y1) = (at(r.y, from.1, to.1), at(r.y + r.h, from.1, to.1));
        Measured { rect: Rect { w: x1 - x0, h: y1 - y0, x: x0, y: y0 }, ..self }
    }
}

/// The detector's two levels, in luma steps (0-255).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Levels {
    /// Black: 0 for full-range pixels (mpv's screenshots), 16 for luma
    /// straight from a limited-range video.
    pub black: u8,
    /// How far above black a pixel must be to count as lit.
    pub limit: u8,
}

/// SDR video: 24 steps above black, close to the 0.09 of the range the
/// `cropdetect` setting uses (`crop::CROPDETECT`).
pub const SDR: Levels = Levels { black: 0, limit: 24 };
/// HDR (PQ, HLG) has dark picture much nearer black; 0.07 of the range, as
/// `crop::CROPDETECT_HDR`.
pub const HDR: Levels = Levels { black: 0, limit: 18 };

/// The levels for video with this `video-params/gamma`, as
/// [`cropdetect_for`](crate::crop::cropdetect_for).
pub fn levels_for(gamma: Option<&str>) -> Levels {
    match gamma {
        Some("pq" | "hlg") => HDR,
        _ => SDR,
    }
}

/// Samples taken along each line: enough to see a lit area a few pixels
/// wide in a 4K frame's 3840 px only by luck, which is fine, since bars are
/// judged by the whole line and a picture line has light all along it.
const SAMPLES: usize = 512;
/// A line with no more than this share of lit samples (per mille) is bar:
/// room for noise, film grain and compression speckle in a black bar.
const BAR_LIT_PERMILLE: usize = 10;
/// A crisp edge: within this many lines after the bar, a line with at least
/// [`CRISP_LIT_PERCENT`] of its samples lit. Two lines of slack for the
/// soft edge scaling and compression leave.
pub const CRISP_LINES: usize = 3;
const CRISP_LIT_PERCENT: usize = 25;

/// The bars of one frame, or `None` for a frame with no lit line at all (a
/// fade to black, which says nothing about bars) or one that doesn't fit
/// its own size.
pub fn detect(frame: &Frame, levels: Levels) -> Option<Measured> {
    if !frame.fits() {
        return None;
    }
    let threshold = u16::from(levels.black) + u16::from(levels.limit);
    let lit = |x: usize, y: usize| u16::from(frame.luma(x, y)) > threshold;
    // Evenly spread positions along a line of `len` pixels, between `from` and `to`.
    let spread = |from: usize, to: usize| {
        let n = (to - from).min(SAMPLES);
        (0..n).map(move |i| from + (2 * i + 1) * (to - from) / (2 * n))
    };
    // Share of lit samples, per mille, along row `y` (columns `x0..x1`) or column `x` (rows `y0..y1`).
    let row = |y: usize, (x0, x1): (usize, usize)| {
        let n = (x1 - x0).min(SAMPLES);
        spread(x0, x1).filter(|&x| lit(x, y)).count() * 1000 / n
    };
    let col = |x: usize, (y0, y1): (usize, usize)| {
        let n = (y1 - y0).min(SAMPLES);
        spread(y0, y1).filter(|&y| lit(x, y)).count() * 1000 / n
    };
    // Lines that are bar, running in from one edge: `line(i)` is the i-th line from that edge.
    let run_in =
        |len: usize, line: &dyn Fn(usize) -> usize| (0..len).take_while(|&i| line(i) <= BAR_LIT_PERMILLE).count();
    let crisp = |bar: usize, len: usize, line: &dyn Fn(usize) -> usize| {
        bar > 0 && (bar..(bar + CRISP_LINES).min(len)).any(|i| line(i) >= CRISP_LIT_PERCENT * 10)
    };

    let (w, h) = (frame.w, frame.h);
    let across = (0, w);
    let top = run_in(h, &|i| row(i, across));
    if top == h {
        return None; // nothing lit anywhere
    }
    let bottom = run_in(h - top, &|i| row(h - 1 - i, across));
    // Columns are judged only over the picture's rows, so a letterbox doesn't dilute them.
    let down = (top, h - bottom);
    let left = run_in(w, &|i| col(i, down));
    let right = run_in(w - left, &|i| col(w - 1 - i, down));
    let (rows, cols) = (h - top - bottom, w - left - right);
    Some(Measured {
        rect: Rect { w: cols as i64, h: rows as i64, x: left as i64, y: top as i64 },
        crisp: [
            crisp(top, h - bottom, &|i| row(i, across)),
            crisp(bottom, h - top, &|i| row(h - 1 - i, across)),
            crisp(left, w - right, &|i| col(i, down)),
            crisp(right, w - left, &|i| col(w - 1 - i, down)),
        ],
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// A test picture: `w`x`h` luma, made by `paint(x, y)`, with black bars
    /// of `v` lines top and bottom and `hz` columns left and right.
    pub(crate) fn letterboxed(
        w: usize,
        h: usize,
        (v, hz): (usize, usize),
        paint: impl Fn(usize, usize) -> u8,
    ) -> Vec<u8> {
        let mut seed = 0x2545_f491_u32;
        let mut noise = move || {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            (seed % 9) as u8 // bars aren't perfectly black: grain and compression
        };
        let mut out = vec![0; w * h];
        for y in 0..h {
            for x in 0..w {
                let bar = y < v || y >= h - v || x < hz || x >= w - hz;
                out[y * w + x] = if bar { noise() } else { paint(x, y) };
            }
        }
        out
    }

    /// Lit, textured picture.
    pub(crate) fn scene(x: usize, y: usize) -> u8 {
        (60 + (x * 7 + y * 13) % 150) as u8
    }

    fn luma(w: usize, h: usize, data: &[u8]) -> Frame<'_> {
        Frame { w, h, stride: w, format: PixelFormat::Luma8, data }
    }

    #[test]
    fn finds_a_letterbox_with_crisp_edges() {
        let data = letterboxed(1920, 1080, (140, 0), scene);
        let m = detect(&luma(1920, 1080, &data), SDR).unwrap();
        assert_eq!(m.rect, Rect { w: 1920, h: 800, x: 0, y: 140 });
        assert_eq!(m.crisp, [true, true, false, false]);
    }

    #[test]
    fn finds_pillarbox_and_windowbox() {
        let data = letterboxed(1920, 1080, (0, 240), scene);
        let m = detect(&luma(1920, 1080, &data), SDR).unwrap();
        assert_eq!(m.rect, Rect { w: 1440, h: 1080, x: 240, y: 0 });
        assert_eq!(m.crisp, [false, false, true, true]);
        let data = letterboxed(1920, 1080, (60, 100), scene);
        assert_eq!(detect(&luma(1920, 1080, &data), SDR).unwrap().rect, Rect { w: 1720, h: 960, x: 100, y: 60 });
    }

    #[test]
    fn full_frame_and_black_frames() {
        let data = letterboxed(1280, 720, (0, 0), scene);
        let m = detect(&luma(1280, 720, &data), SDR).unwrap();
        assert_eq!(m.rect, Rect { w: 1280, h: 720, x: 0, y: 0 });
        assert_eq!(m.crisp, [false; 4]);
        let black = letterboxed(1280, 720, (0, 0), |_, _| 5);
        assert_eq!(detect(&luma(1280, 720, &black), SDR), None, "a fade says nothing");
    }

    #[test]
    fn dark_picture_by_a_bar_is_not_crisp() {
        // A night scene: light comes up unevenly over the first 60 lines below the bar.
        let night = |x: usize, y: usize| {
            let depth = y.saturating_sub(140);
            if depth < 60 {
                (depth * ((x * 37 + y * 11) % 101) / 80) as u8
            } else {
                scene(x, y)
            }
        };
        let data = letterboxed(1920, 1080, (140, 0), night);
        let m = detect(&luma(1920, 1080, &data), SDR).unwrap();
        assert!((150..180).contains(&m.rect.y), "the darkest lines read as bar: {m:?}");
        assert!(!m.crisp[0] && m.crisp[1], "{m:?}");
    }

    #[test]
    fn a_few_lit_specks_in_a_bar_are_still_bar() {
        let mut data = letterboxed(1920, 1080, (140, 0), scene);
        for x in (0..1920).step_by(400) {
            data[20 * 1920 + x] = 255; // dead pixels, a stray speck of compression
        }
        assert_eq!(detect(&luma(1920, 1080, &data), SDR).unwrap().rect.y, 140);
    }

    #[test]
    fn reads_mpv_screenshots() {
        // bgr0 with padding at the end of each line, as screenshot-raw may hand it over.
        let (w, h, stride) = (640, 360, 640 * 4 + 64);
        let gray = letterboxed(w, h, (45, 0), scene);
        let mut data = vec![0u8; stride * h];
        for y in 0..h {
            for x in 0..w {
                let v = gray[y * w + x];
                data[y * stride + x * 4..][..4].copy_from_slice(&[v, v, v, 0]);
            }
        }
        let frame = Frame { w, h, stride, format: PixelFormat::Bgr0, data: &data };
        assert_eq!(detect(&frame, SDR).unwrap().rect, Rect { w: 640, h: 270, x: 0, y: 45 });
        let short = Frame { data: &data[..stride * (h - 1)], ..frame };
        assert_eq!(detect(&short, SDR), None, "a frame shorter than its size");
    }

    #[test]
    fn with_the_tracker_lit_letterbox_crops_on_its_first_frame() {
        use crate::crop::CropTracker;
        let (w, h) = (960, 540);
        let full = letterboxed(w, h, (0, 0), scene);
        let scope = letterboxed(w, h, (70, 0), scene);
        let black = letterboxed(w, h, (0, 0), |_, _| 3);
        let mut t = CropTracker::default();
        let mut shown = Vec::new();
        for data in [&full, &full, &scope, &scope, &black, &black, &scope, &full] {
            t.update_measured(1, (960, 540), (960, 540), detect(&luma(w, h, data), SDR));
            shown.push(t.bars(1).0);
        }
        assert_eq!(shown, [0, 0, 70, 70, 70, 70, 70, 0]);
    }

    #[test]
    fn reads_rgb_and_scales_to_video_pixels() {
        let (w, h) = (640, 360);
        let rgb: Vec<u8> = letterboxed(w, h, (45, 20), scene).into_iter().flat_map(|v| [v, v, v]).collect();
        let frame = Frame { w, h, stride: w * 3, format: PixelFormat::Rgb8, data: &rgb };
        let m = detect(&frame, levels_for(Some("bt.1886"))).unwrap();
        assert_eq!(m.rect, Rect { w: 600, h: 270, x: 20, y: 45 });
        // Anamorphic: a 720x480 frame shown (and screenshotted) at 640x360.
        let s = m.scaled((640, 360), (720, 480));
        assert_eq!(s.rect, Rect { w: 675, h: 360, x: 23, y: 60 });
        assert_eq!(s.crisp, m.crisp);
        assert_eq!(m.scaled((640, 360), (640, 360)), m);
        assert_eq!(levels_for(Some("pq")), HDR);
    }

    #[test]
    fn limited_range_black() {
        let data: Vec<u8> = letterboxed(1920, 1080, (140, 0), scene).into_iter().map(|v| v.max(16)).collect();
        let m = detect(&luma(1920, 1080, &data), Levels { black: 16, ..SDR }).unwrap();
        assert_eq!(m.rect.y, 140);
    }
}
