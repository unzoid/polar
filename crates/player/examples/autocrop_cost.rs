//! What our detector costs per frame on the desktop (docs/autocrop.md §2,
//! "Our detector on the desktop"): the size of the PNG mpv writes for each
//! screenshot at compression 0 (Windows, Linux), and the CPU time of reading
//! it (`png::decode_stored`) and of `bars::detect`, against `detect` on the
//! `bgr0` frame libmpv hands over in memory (macOS). mpv's own share (taking
//! the screenshot, writing the file) needs the desktop build.
//!
//! ```text
//! cargo run --release -p polar-player --example autocrop_cost
//! ```

use std::hint::black_box;
use std::time::Instant;

use polar_player::bars::{detect, Frame, PixelFormat, SDR};
use polar_player::png::decode_stored;

const RUNS: usize = 40;

fn main() {
    println!("| frame | PNG per frame | written per second at 24 fps | read PNG + detect | detect on bgr0 |");
    println!("|---|---|---|---|---|");
    for (w, h) in [(1920, 1080), (3840, 2160)] {
        let png = stored_png(w, h);
        let bgr0 = picture(w, h, 4);
        let per_png = time(|| {
            let img = decode_stored(black_box(&png)).expect("a stored PNG");
            black_box(detect(&img.frame(), SDR));
        });
        let frame = Frame { w, h, stride: w * 4, format: PixelFormat::Bgr0, data: &bgr0 };
        let per_bgr0 = time(|| {
            black_box(detect(black_box(&frame), SDR));
        });
        println!(
            "| {w}x{h} | {:.2} MB | {:.0} MB | {per_png:.1} ms | {per_bgr0:.2} ms |",
            png.len() as f64 / 1e6,
            png.len() as f64 * 24.0 / 1e6,
        );
    }
}

/// Milliseconds per run of `f`, the median of [`RUNS`].
fn time(mut f: impl FnMut()) -> f64 {
    f();
    let mut ms: Vec<f64> = (0..RUNS)
        .map(|_| {
            let t = Instant::now();
            f();
            t.elapsed().as_secs_f64() * 1000.0
        })
        .collect();
    ms.sort_by(f64::total_cmp);
    ms[RUNS / 2]
}

/// A 2.39:1 picture letterboxed in `w` x `h`, `channels` bytes a pixel: black
/// bars, a noisy lit picture between them.
fn picture(w: usize, h: usize, channels: usize) -> Vec<u8> {
    let bar = (h - (w as f64 / 2.39) as usize) / 2;
    let mut px = vec![0u8; w * h * channels];
    let mut seed = 0x2545_f491_u32;
    for y in bar..h - bar {
        for x in 0..w * channels {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            px[y * w * channels + x] = 40 + (seed % 160) as u8;
        }
    }
    px
}

/// The PNG mpv writes at `--screenshot-png-compression=0` and filter 0:
/// RGB, each line with filter byte 0, stored in zlib blocks of 65535 bytes.
fn stored_png(w: usize, h: usize) -> Vec<u8> {
    let px = picture(w, h, 3);
    let mut raw = Vec::with_capacity(h * (w * 3 + 1));
    for line in px.chunks_exact(w * 3) {
        raw.push(0);
        raw.extend_from_slice(line);
    }
    let mut zlib = vec![0x78, 0x01];
    let blocks: Vec<&[u8]> = raw.chunks(65535).collect();
    for (i, b) in blocks.iter().enumerate() {
        zlib.push(u8::from(i + 1 == blocks.len()));
        zlib.extend_from_slice(&(b.len() as u16).to_le_bytes());
        zlib.extend_from_slice(&(!(b.len() as u16)).to_le_bytes());
        zlib.extend_from_slice(b);
    }
    zlib.extend_from_slice(&[0; 4]); // adler-32, not checked
    let mut ihdr = Vec::new();
    ihdr.extend_from_slice(&(w as u32).to_be_bytes());
    ihdr.extend_from_slice(&(h as u32).to_be_bytes());
    ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
    let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
    let mut chunk = |kind: &[u8], data: &[u8]| {
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        out.extend_from_slice(kind);
        out.extend_from_slice(data);
        out.extend_from_slice(&[0; 4]); // crc, not checked
    };
    chunk(b"IHDR", &ihdr);
    for part in zlib.chunks(1 << 20) {
        chunk(b"IDAT", part);
    }
    chunk(b"IEND", &[]);
    out
}
