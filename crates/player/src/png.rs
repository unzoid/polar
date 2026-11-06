//! Reads the PNG screenshots the pre-roll probe has mpv write
//! (docs/autocrop.md §3). mpv's JSON IPC can't carry `screenshot-raw`'s
//! bytes, so the probe asks for files with `--screenshot-png-compression=0`:
//! the image data is then stored, not compressed (zlib's level 0), and
//! reading it takes only undoing PNG's per-line filters. Anything else
//! (compressed data, interlacing, 16-bit or palette pixels) is `None`, and
//! the probe goes without that reading.

use crate::bars::{Frame, PixelFormat};

/// A decoded picture, 3 bytes (red, green, blue) per pixel, no padding.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Image {
    pub w: usize,
    pub h: usize,
    pub rgb: Vec<u8>,
}

impl Image {
    /// The picture as [`bars::detect`](crate::bars::detect) reads it.
    pub fn frame(&self) -> Frame<'_> {
        Frame { w: self.w, h: self.h, stride: self.w * 3, format: PixelFormat::Rgb8, data: &self.rgb }
    }
}

/// Larger pictures than this (pixels) aren't screenshots of a video.
const MAX_PIXELS: usize = 8192 * 8192;

/// Decode a PNG whose data is stored uncompressed; see the module notes.
pub fn decode_stored(file: &[u8]) -> Option<Image> {
    let mut rest = file.strip_prefix(b"\x89PNG\r\n\x1a\n")?;
    let mut header = None;
    let mut zlib = Vec::new();
    while rest.len() >= 12 {
        let len = u32::from_be_bytes(rest[..4].try_into().ok()?) as usize;
        let kind = &rest[4..8];
        let data = rest.get(8..8 + len)?;
        match kind {
            b"IHDR" if data.len() == 13 => header = Some(data),
            b"IDAT" => zlib.extend_from_slice(data),
            b"IEND" => break,
            _ => {}
        }
        rest = rest.get(12 + len..)?;
    }
    let h = header?;
    let (w, ht) =
        (u32::from_be_bytes(h[0..4].try_into().ok()?) as usize, u32::from_be_bytes(h[4..8].try_into().ok()?) as usize);
    let channels = match (h[8], h[9]) {
        (8, 0) => 1, // gray
        (8, 2) => 3, // RGB
        (8, 4) => 2, // gray and alpha
        (8, 6) => 4, // RGBA
        _ => return None,
    };
    if w == 0 || ht == 0 || w.checked_mul(ht)? > MAX_PIXELS || h[10] != 0 || h[11] != 0 || h[12] != 0 {
        return None;
    }
    let line = w * channels;
    let raw = inflate_stored(&zlib, ht * (line + 1))?;
    let mut rgb = Vec::with_capacity(w * ht * 3);
    let mut prev = vec![0u8; line];
    let mut cur = vec![0u8; line];
    for row in raw.chunks_exact(line + 1) {
        // What mpv writes at filter 0: RGB lines as they are, copied whole.
        if row[0] == 0 && channels == 3 {
            rgb.extend_from_slice(&row[1..]);
            prev.copy_from_slice(&row[1..]);
            continue;
        }
        unfilter(row[0], &row[1..], &prev, &mut cur, channels)?;
        match channels {
            1 | 2 => cur.chunks_exact(channels).for_each(|px| rgb.extend_from_slice(&[px[0]; 3])),
            3 => rgb.extend_from_slice(&cur),
            _ => cur.as_chunks::<4>().0.iter().for_each(|px| rgb.extend_from_slice(&px[..3])),
        }
        std::mem::swap(&mut prev, &mut cur);
    }
    Some(Image { w, h: ht, rgb })
}

/// The bytes of a zlib stream made only of stored blocks, which must come
/// to exactly `size`.
fn inflate_stored(zlib: &[u8], size: usize) -> Option<Vec<u8>> {
    let (&cmf, &flg) = (zlib.first()?, zlib.get(1)?);
    if cmf & 0x0f != 8 || (u16::from(cmf) << 8 | u16::from(flg)) % 31 != 0 || flg & 0x20 != 0 {
        return None;
    }
    let mut out = Vec::with_capacity(size);
    let mut at = 2;
    loop {
        // Every block is stored, so each header starts a byte: final bit, then type 00.
        let head = *zlib.get(at)?;
        if head & 0b110 != 0 {
            return None;
        }
        let len = u16::from_le_bytes(zlib.get(at + 1..at + 3)?.try_into().ok()?);
        let nlen = u16::from_le_bytes(zlib.get(at + 3..at + 5)?.try_into().ok()?);
        if len != !nlen || out.len() + usize::from(len) > size {
            return None;
        }
        out.extend_from_slice(zlib.get(at + 5..at + 5 + usize::from(len))?);
        at += 5 + usize::from(len);
        if head & 1 == 1 {
            break;
        }
    }
    (out.len() == size).then_some(out)
}

/// Undo one line's PNG filter (`kind`) into `out`, given the line above.
fn unfilter(kind: u8, line: &[u8], prev: &[u8], out: &mut [u8], bpp: usize) -> Option<()> {
    for i in 0..line.len() {
        let a = if i >= bpp { out[i - bpp] } else { 0 };
        let b = prev[i];
        let c = if i >= bpp { prev[i - bpp] } else { 0 };
        let predicted = match kind {
            0 => 0,
            1 => a,
            2 => b,
            3 => ((u16::from(a) + u16::from(b)) / 2) as u8,
            4 => paeth(a, b, c),
            _ => return None,
        };
        out[i] = line[i].wrapping_add(predicted);
    }
    Some(())
}

fn paeth(a: u8, b: u8, c: u8) -> u8 {
    let p = i16::from(a) + i16::from(b) - i16::from(c);
    let (pa, pb, pc) = ((p - i16::from(a)).abs(), (p - i16::from(b)).abs(), (p - i16::from(c)).abs());
    if pa <= pb && pa <= pc {
        a
    } else if pb <= pc {
        b
    } else {
        c
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A PNG as mpv writes one at compression 0: `channels` 8-bit samples a
    /// pixel, line `y` filtered with `filters[y % len]`, the data stored in
    /// zlib blocks of at most `block` bytes and split over IDATs of `idat`.
    fn encode(w: usize, h: usize, channels: usize, px: &[u8], filters: &[u8], block: usize, idat: usize) -> Vec<u8> {
        let line = w * channels;
        let mut raw = Vec::new();
        for y in 0..h {
            let kind = filters[y % filters.len()];
            raw.push(kind);
            let cur = &px[y * line..][..line];
            let zero = vec![0; line];
            let prev = if y > 0 { &px[(y - 1) * line..][..line] } else { &zero[..] };
            for i in 0..line {
                let a = if i >= channels { cur[i - channels] } else { 0 };
                let c = if i >= channels { prev[i - channels] } else { 0 };
                let predicted = match kind {
                    0 => 0,
                    1 => a,
                    2 => prev[i],
                    3 => ((u16::from(a) + u16::from(prev[i])) / 2) as u8,
                    _ => paeth(a, prev[i], c),
                };
                raw.push(cur[i].wrapping_sub(predicted));
            }
        }
        let mut zlib = vec![0x78, 0x01];
        let blocks: Vec<&[u8]> = raw.chunks(block).collect();
        for (i, b) in blocks.iter().enumerate() {
            zlib.push(u8::from(i + 1 == blocks.len()));
            zlib.extend_from_slice(&(b.len() as u16).to_le_bytes());
            zlib.extend_from_slice(&(!(b.len() as u16)).to_le_bytes());
            zlib.extend_from_slice(b);
        }
        zlib.extend_from_slice(&[0; 4]); // adler-32, not checked
        let color = match channels {
            1 => 0,
            2 => 4,
            3 => 2,
            _ => 6,
        };
        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(&(w as u32).to_be_bytes());
        ihdr.extend_from_slice(&(h as u32).to_be_bytes());
        ihdr.extend_from_slice(&[8, color, 0, 0, 0]);
        let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut chunk = |kind: &[u8], data: &[u8]| {
            out.extend_from_slice(&(data.len() as u32).to_be_bytes());
            out.extend_from_slice(kind);
            out.extend_from_slice(data);
            out.extend_from_slice(&[0; 4]); // crc, not checked
        };
        chunk(b"IHDR", &ihdr);
        chunk(b"tEXt", b"Software\0mpv");
        for part in zlib.chunks(idat) {
            chunk(b"IDAT", part);
        }
        chunk(b"IEND", &[]);
        out
    }

    fn picture(w: usize, h: usize, channels: usize) -> Vec<u8> {
        (0..w * h * channels).map(|i| ((i * 37) ^ (i / 7)) as u8).collect()
    }

    #[test]
    fn reads_every_filter_across_blocks_and_chunks() {
        let (w, h) = (33, 20);
        let px = picture(w, h, 3);
        let png = encode(w, h, 3, &px, &[0, 1, 2, 3, 4], 100, 64);
        assert_eq!(decode_stored(&png), Some(Image { w, h, rgb: px }));
    }

    #[test]
    fn gray_and_alpha_become_rgb() {
        let (w, h) = (9, 4);
        let gray = picture(w, h, 1);
        let img = decode_stored(&encode(w, h, 1, &gray, &[4, 1], 1000, 1000)).unwrap();
        assert_eq!(img.rgb, gray.iter().flat_map(|&v| [v; 3]).collect::<Vec<_>>());
        let rgba = picture(w, h, 4);
        let img = decode_stored(&encode(w, h, 4, &rgba, &[3], 50, 1000)).unwrap();
        assert_eq!(img.rgb, rgba.chunks(4).flat_map(|p| p[..3].to_vec()).collect::<Vec<_>>());
    }

    #[test]
    fn compressed_or_broken_files_are_none() {
        let (w, h) = (16, 8);
        let px = picture(w, h, 3);
        let png = encode(w, h, 3, &px, &[0], 1000, 1000);
        // The first block's header sits right after the 2-byte zlib header in the only IDAT.
        let idat = png.windows(4).position(|c| c == b"IDAT").unwrap() + 4;
        let mut fixed = png.clone();
        fixed[idat + 2] = 0b011; // final, fixed Huffman codes
        assert_eq!(decode_stored(&fixed), None);
        assert_eq!(decode_stored(&png[..png.len() - 40]), None, "cut short");
        assert_eq!(decode_stored(&png[1..]), None, "not a PNG");
        let mut sixteen = png.clone();
        let ihdr = png.windows(4).position(|c| c == b"IHDR").unwrap() + 4;
        sixteen[ihdr + 8] = 16;
        assert_eq!(decode_stored(&sixteen), None, "16-bit samples");
    }

    #[test]
    fn a_letterboxed_screenshot_reaches_the_detector() {
        use crate::bars::{detect, tests::letterboxed, tests::scene, SDR};
        use crate::crop::Rect;
        let (w, h) = (480, 270);
        let rgb: Vec<u8> = letterboxed(w, h, (35, 0), scene).into_iter().flat_map(|v| [v, v / 2, v]).collect();
        let img = decode_stored(&encode(w, h, 3, &rgb, &[4], 65535, 8192)).unwrap();
        assert_eq!(detect(&img.frame(), SDR).unwrap().rect, Rect { w: 480, h: 200, x: 0, y: 35 });
    }
}
