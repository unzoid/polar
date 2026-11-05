//! Our own bar detector (`polar_player::bars`) against FFmpeg's `cropdetect`
//! on the same frames, both through the same `CropTracker`, scored against
//! the bars the clip is known to have. `scripts/autocrop-compare.sh` makes
//! such a clip from any film and runs this; docs/autocrop.md says how to read
//! the result.
//!
//! ```text
//! autocrop_compare --size 1920x1080 --fps 24 --truth 0:0:0,6:138:0,... \
//!     [--cropdetect cropdetect.txt] [--black 0] [--limit 24] < frames.gray
//! ```
//!
//! stdin: the clip's frames as raw 8-bit luma (`-f rawvideo -pix_fmt gray`).
//! `--truth`: from each start time (seconds), the bars it has (top and
//! bottom, left and right). `--cropdetect`: FFmpeg's `metadata=mode=print`
//! output for `cropdetect=limit=0.09:round=2:reset=1` on the same clip.

use std::io::Read;

use polar_player::bars::{detect, Frame, Levels, PixelFormat, SDR};
use polar_player::crop::{cropdetect_reading, CropTracker, Rect};
use serde_json::{Map, Value};

/// Bars within this many pixels of the truth count as right (the tracker's own slack).
const SLACK: i64 = 4;

fn main() {
    if let Err(e) = run() {
        eprintln!("autocrop_compare: {e}");
        std::process::exit(2);
    }
}

fn run() -> Result<(), String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let arg = |name: &str| args.iter().position(|a| a == name).and_then(|i| args.get(i + 1)).map(String::as_str);
    let (w, h) = arg("--size")
        .and_then(|s| s.split_once('x'))
        .and_then(|(w, h)| Some((w.parse::<usize>().ok()?, h.parse::<usize>().ok()?)))
        .ok_or("--size WxH is needed")?;
    let fps: f64 = arg("--fps").and_then(|s| s.parse().ok()).ok_or("--fps is needed")?;
    let truth = parse_truth(arg("--truth").ok_or("--truth is needed")?)?;
    let levels = Levels {
        black: arg("--black").map_or(Ok(SDR.black), str::parse).map_err(|_| "--black: 0-255")?,
        limit: arg("--limit").map_or(Ok(SDR.limit), str::parse).map_err(|_| "--limit: 0-255")?,
    };
    let cropdetect = match arg("--cropdetect") {
        Some(path) => Some(parse_cropdetect(&std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?)),
        None => None,
    };

    let full = (w as i64, h as i64);
    let mut ours = Run::new("own detector");
    let mut ours_plain = Run::new("own detector, crisp edges ignored");
    let mut theirs = Run::new("cropdetect");
    let mut buf = vec![0u8; w * h];
    let mut stdin = std::io::stdin().lock();
    let mut n = 0usize;
    while read_frame(&mut stdin, &mut buf)? {
        let want = truth_at(&truth, n as f64 / fps);
        let frame = Frame { w, h, stride: w, format: PixelFormat::Luma8, data: &buf };
        let measured = detect(&frame, levels);
        ours.tracker.update_measured(1, full, full, measured);
        ours_plain.tracker.update(1, full, full, measured.map(|m| m.rect));
        ours.score(want);
        ours_plain.score(want);
        if let Some(readings) = &cropdetect {
            theirs.tracker.update(1, full, full, readings.get(n).copied().flatten());
            theirs.score(want);
        }
        n += 1;
    }
    if n == 0 {
        return Err("no frames on stdin".into());
    }
    let mut runs = vec![ours, ours_plain];
    if cropdetect.is_some() {
        runs.push(theirs);
    }
    print!("{}", table(&runs, n, fps));
    Ok(())
}

fn read_frame(r: &mut impl Read, buf: &mut [u8]) -> Result<bool, String> {
    let mut got = 0;
    while got < buf.len() {
        match r.read(&mut buf[got..]).map_err(|e| e.to_string())? {
            0 if got == 0 => return Ok(false),
            0 => return Err("the last frame is cut short: is --size right?".into()),
            k => got += k,
        }
    }
    Ok(true)
}

/// From each start time (seconds), the bars (top and bottom, left and right).
type Truth = Vec<(f64, (i64, i64))>;

/// `start:v:h,...` → (start seconds, bars), in order.
fn parse_truth(spec: &str) -> Result<Truth, String> {
    let mut out: Truth = Vec::new();
    for part in spec.split(',') {
        let mut f = part.split(':');
        let (Some(t), Some(v), Some(h), None) = (f.next(), f.next(), f.next(), f.next()) else {
            return Err(format!("--truth: '{part}' isn't start:v:h"));
        };
        let bad = || format!("--truth: '{part}' isn't start:v:h");
        let t: f64 = t.parse().map_err(|_| bad())?;
        if out.last().is_some_and(|(prev, _)| *prev >= t) {
            return Err("--truth: start times must go up".into());
        }
        out.push((t, (v.parse().map_err(|_| bad())?, h.parse().map_err(|_| bad())?)));
    }
    Ok(out)
}

fn truth_at(truth: &[(f64, (i64, i64))], t: f64) -> (i64, i64) {
    truth.iter().rev().find(|(start, _)| *start <= t + 1e-9).map_or((0, 0), |(_, b)| *b)
}

/// FFmpeg's `metadata=mode=print` lines: `frame:N pts:… pts_time:…` and then
/// `lavfi.cropdetect.<key>=<value>` for that frame.
fn parse_cropdetect(text: &str) -> Vec<Option<Rect>> {
    let mut frames: Vec<Option<Rect>> = Vec::new();
    let mut current: Option<(usize, Map<String, Value>)> = None;
    let flush = |cur: Option<(usize, Map<String, Value>)>, frames: &mut Vec<Option<Rect>>| {
        if let Some((n, meta)) = cur {
            if frames.len() <= n {
                frames.resize(n + 1, None);
            }
            frames[n] = cropdetect_reading(&Value::Object(meta));
        }
    };
    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("frame:") {
            flush(current.take(), &mut frames);
            current = rest.split_whitespace().next().and_then(|n| n.parse().ok()).map(|n| (n, Map::new()));
        } else if let (Some((_, meta)), Some((k, v))) = (current.as_mut(), line.split_once('=')) {
            meta.insert(k.trim().to_string(), Value::String(v.trim().to_string()));
        }
    }
    flush(current, &mut frames);
    frames
}

/// One method's tracker and its score so far.
struct Run {
    name: &'static str,
    tracker: CropTracker,
    last: (i64, i64),
    changes: usize,
    /// Frames that cut picture off (more bar removed than there is).
    cut: usize,
    /// Frames with bars left on screen that could have gone.
    left: usize,
    /// Per stretch of bars: frames until they were cropped (None: never).
    locks: Vec<Option<usize>>,
    /// Bars of the stretch being timed, and frames into it.
    timing: Option<((i64, i64), usize)>,
    prev_want: (i64, i64),
    /// How each change would be shown (`CropZoom`): [on the cut, followed,
    /// eased because late, correcting a misread at once, the same eased,
    /// into a misread].
    kinds: [usize; 6],
    /// The bars shown now came from a misread.
    misread: bool,
}

impl Run {
    fn new(name: &'static str) -> Self {
        Run {
            name,
            tracker: CropTracker::default(),
            last: (0, 0),
            changes: 0,
            cut: 0,
            left: 0,
            locks: Vec::new(),
            timing: None,
            prev_want: (0, 0),
            kinds: [0; 6],
            misread: false,
        }
    }

    fn score(&mut self, want: (i64, i64)) {
        let shown = self.tracker.bars(1);
        let close = |a: i64, b: i64| (a - b).abs() <= SLACK;
        let right = |b: (i64, i64), want: (i64, i64)| close(b.0, want.0) && close(b.1, want.1);
        if shown != self.last {
            self.changes += 1;
            let at_once = self.tracker.on_cut();
            let kind = match (right(shown, want), self.misread) {
                (false, _) => 5,
                (true, true) if at_once => 3,
                (true, true) => 4,
                _ if self.tracker.following() => 1,
                _ if at_once => 0,
                _ => 2,
            };
            self.kinds[kind] += 1;
            self.misread = kind == 5;
            self.last = shown;
        }
        if shown.0 > want.0 + SLACK || shown.1 > want.1 + SLACK {
            self.cut += 1;
        } else if !close(shown.0, want.0) || !close(shown.1, want.1) {
            self.left += 1;
        }
        if want != self.prev_want {
            if self.timing.take().is_some() {
                self.locks.push(None);
            }
            if want != (0, 0) {
                self.timing = Some((want, 0));
            }
            self.prev_want = want;
        }
        if let Some((bars, frames)) = self.timing {
            if close(shown.0, bars.0) && close(shown.1, bars.1) {
                self.locks.push(Some(frames));
                self.timing = None;
            } else {
                self.timing = Some((bars, frames + 1));
            }
        }
    }

    fn finish(&self) -> Vec<Option<usize>> {
        let mut locks = self.locks.clone();
        if self.timing.is_some() {
            locks.push(None);
        }
        locks
    }
}

fn table(runs: &[Run], frames: usize, fps: f64) -> String {
    let minutes = frames as f64 / fps / 60.0;
    let ms = |f: usize| (f as f64 * 1000.0 / fps).round() as i64;
    let mut out = format!("{frames} frames, {:.1} s\n\n", frames as f64 / fps);
    out += "| method | first crop: mean / max (ms) | bars never cropped | changes/min | frames cutting picture | frames with bars left |\n";
    out += "|---|---|---|---|---|---|\n";
    for r in runs {
        let locks = r.finish();
        let done: Vec<usize> = locks.iter().flatten().copied().collect();
        let mean = if done.is_empty() { "-".into() } else { ms(done.iter().sum::<usize>() / done.len()).to_string() };
        let max = done.iter().max().map_or("-".into(), |&m| ms(m).to_string());
        out += &format!(
            "| {} | {mean} / {max} | {} of {} | {:.1} | {} | {} |\n",
            r.name,
            locks.len() - done.len(),
            locks.len(),
            r.changes as f64 / minutes,
            r.cut,
            r.left
        );
    }
    out += "\nHow each change would be shown (docs/autocrop.md §6):\n\n";
    out += "| method | on the cut | following animated bars | eased: caught late | correcting a misread: at once / eased | into a misread |\n";
    out += "|---|---|---|---|---|---|\n";
    for r in runs {
        let [a, b, c, d, e, f] = r.kinds;
        out += &format!("| {} | {a} | {b} | {c} | {d} / {e} | {f} |\n", r.name);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_truth_and_cropdetect_output() {
        let t = parse_truth("0:0:0,6:138:0,12.5:0:240").unwrap();
        assert_eq!(truth_at(&t, 5.99), (0, 0));
        assert_eq!(truth_at(&t, 6.0), (138, 0));
        assert_eq!(truth_at(&t, 13.0), (0, 240));
        assert!(parse_truth("0:0:0,0:1:1").is_err());
        assert!(parse_truth("0:0").is_err());
        let meta = "frame:0    pts:0       pts_time:0\nlavfi.cropdetect.x1=0\nlavfi.cropdetect.w=1920\nlavfi.cropdetect.h=800\n\
                    lavfi.cropdetect.x=0\nlavfi.cropdetect.y=140\nframe:2    pts:2       pts_time:0.0833\nlavfi.cropdetect.w=1920\n\
                    lavfi.cropdetect.h=1080\nlavfi.cropdetect.x=0\nlavfi.cropdetect.y=0\n";
        let r = parse_cropdetect(meta);
        assert_eq!(r.len(), 3);
        assert_eq!(r[0], Some(Rect { w: 1920, h: 800, x: 0, y: 140 }));
        assert_eq!(r[1], None);
        assert_eq!(r[2].map(|r| r.h), Some(1080));
    }

    #[test]
    fn scores_lock_time_cuts_and_changes() {
        let mut r = Run::new("x");
        // Truth: 2 frames full, then bars of 140 for 4 frames; the tracker is fed by hand.
        let full = Rect { w: 1920, h: 1080, x: 0, y: 0 };
        let scope = Rect { w: 1920, h: 800, x: 0, y: 140 };
        let feed = [
            (full, (0, 0)),
            (full, (0, 0)),
            (scope, (140, 0)),
            (scope, (140, 0)),
            (scope, (140, 0)),
            (scope, (140, 0)),
        ];
        for (rect, want) in feed {
            r.tracker.update(1, (1920, 1080), (1920, 1080), Some(rect));
            r.score(want);
        }
        assert_eq!(r.finish(), vec![Some(3)], "a common shape: cropped on its 4th frame");
        assert_eq!((r.changes, r.cut, r.left), (1, 0, 3));
        assert_eq!(r.kinds, [0, 0, 1, 0, 0, 0], "caught late: eased");
        // A dark shot misread as wider bars, then corrected on the frame it lights up.
        let dark = Rect { w: 1920, h: 700, x: 0, y: 190 };
        for _ in 0..12 {
            r.tracker.update(1, (1920, 1080), (1920, 1080), Some(dark));
            r.score((140, 0));
        }
        for _ in 0..2 {
            r.tracker.update(1, (1920, 1080), (1920, 1080), Some(scope));
            r.score((140, 0));
        }
        assert_eq!(r.kinds, [0, 0, 1, 1, 0, 1], "{:?}", r.kinds);
        let table = table(&[r], 20, 24.0);
        assert!(table.contains("| x | 0 | 0 | 1 | 1 / 0 | 1 |"), "{table}");
    }
}
