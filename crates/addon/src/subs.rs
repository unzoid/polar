//! Subtitle conversion. Addons mostly serve SRT; `<track>` only plays WebVTT.

/// Convert subtitle bytes (SRT or VTT, any line endings, optional BOM) to WebVTT.
pub fn to_vtt(bytes: &[u8]) -> String {
    let text = decode(bytes);
    let text = text.trim_start_matches('\u{feff}').replace("\r\n", "\n").replace('\r', "\n");
    if text.trim_start().starts_with("WEBVTT") {
        return text;
    }
    let mut out = String::with_capacity(text.len() + 16);
    out.push_str("WEBVTT\n\n");
    for line in text.lines() {
        if line.contains("-->") {
            // 00:00:01,000 --> 00:00:02,500  →  00:00:01.000 --> 00:00:02.500
            out.push_str(&line.replace(',', "."));
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

/// UTF-16 when it starts with a byte-order mark, else UTF-8 if valid, else Windows-1252 (the
/// usual encoding of older SRT files: Latin-1 plus curly quotes, dashes and € in 0x80–0x9F).
fn decode(bytes: &[u8]) -> String {
    let utf16 = |be: bool| {
        let units: Vec<u16> = bytes[2..]
            .as_chunks::<2>()
            .0
            .iter()
            .map(|&p| if be { u16::from_be_bytes(p) } else { u16::from_le_bytes(p) })
            .collect();
        String::from_utf16_lossy(&units)
    };
    match bytes {
        [0xFF, 0xFE, ..] => utf16(false),
        [0xFE, 0xFF, ..] => utf16(true),
        _ => match std::str::from_utf8(bytes) {
            Ok(s) => s.to_owned(),
            Err(_) => bytes.iter().map(|&b| windows_1252(b)).collect(),
        },
    }
}

/// Windows-1252: Latin-1, except 0x80–0x9F; its five unassigned bytes stay as Latin-1 does.
fn windows_1252(b: u8) -> char {
    const HIGH: [char; 32] = [
        '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž', '\u{8f}', '\u{90}', '‘',
        '’', '“', '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9d}', 'ž', 'Ÿ',
    ];
    match b {
        0x80..=0x9F => HIGH[(b - 0x80) as usize],
        _ => b as char,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_srt() {
        let srt = "\u{feff}1\r\n00:00:01,000 --> 00:00:02,500\r\nHello, world\r\n\r\n";
        let vtt = to_vtt(srt.as_bytes());
        assert!(vtt.starts_with("WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\nHello, world\n"));
    }

    #[test]
    fn keeps_vtt_and_decodes_latin1() {
        assert_eq!(to_vtt(b"WEBVTT\n\nx"), "WEBVTT\n\nx");
        assert!(to_vtt(&[b'c', b'a', b'f', 0xE9]).ends_with("caf\u{e9}\n"));
    }

    #[test]
    fn decodes_windows_1252_and_utf16() {
        // “Hi” – in Windows-1252: curly quotes and an en dash, not control characters.
        assert!(to_vtt(&[0x93, b'H', b'i', 0x94, b' ', 0x96]).ends_with("\u{201c}Hi\u{201d} \u{2013}\n"));
        let text = "1\r\n00:00:01,000 --> 00:00:02,000\r\nÉté\r\n";
        let le: Vec<u8> = [0xFF, 0xFE].into_iter().chain(text.encode_utf16().flat_map(u16::to_le_bytes)).collect();
        let be: Vec<u8> = [0xFE, 0xFF].into_iter().chain(text.encode_utf16().flat_map(u16::to_be_bytes)).collect();
        for bytes in [le, be] {
            assert_eq!(to_vtt(&bytes), "WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nÉté\n");
        }
    }
}
