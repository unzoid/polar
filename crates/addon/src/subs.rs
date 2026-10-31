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

/// UTF-8 if valid, else Latin-1 (the usual encoding of older SRT files).
fn decode(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(s) => s.to_owned(),
        Err(_) => bytes.iter().map(|&b| b as char).collect(),
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
}
