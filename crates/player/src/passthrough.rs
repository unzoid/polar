//! Serving a trailer through the app (re-test 16): its host doesn't let the web view read the
//! video's frames, which the backdrop needs to find black bars inside the picture. The shell's
//! `trailer` protocol fetches the file instead and answers with CORS allowed. Only links the app
//! itself handed out are served; each answer is at most [`CHUNK`] bytes, so a request for the
//! whole file starts playing after one chunk (the web view asks for the next part itself).

/// The most one answer carries.
pub const CHUNK: u64 = 4 * 1024 * 1024;

/// The `Range` to ask the host for, given what the web view asked: from the same start, at most
/// `chunk` bytes. A suffix range (`bytes=-500`, the file's end) is passed on as it is.
pub fn capped_range(asked: Option<&str>, chunk: u64) -> String {
    let parsed =
        asked.and_then(|r| r.trim().strip_prefix("bytes=")).and_then(|r| r.split_once('-')).and_then(|(a, b)| {
            if a.is_empty() {
                return b.trim().parse::<u64>().ok().map(|n| (None, Some(n)));
            }
            let start = a.trim().parse::<u64>().ok()?;
            Some((Some(start), b.trim().parse::<u64>().ok()))
        });
    match parsed {
        Some((None, Some(n))) => format!("bytes=-{n}"),
        Some((Some(start), end)) => {
            let last = start + chunk - 1;
            format!("bytes={start}-{}", end.map_or(last, |e| e.min(last)))
        }
        _ => format!("bytes=0-{}", chunk - 1),
    }
}

/// A link as the protocol's path: hex, so nothing in it needs escaping on any platform.
pub fn to_hex(link: &str) -> String {
    link.bytes().map(|b| format!("{b:02x}")).collect()
}

/// [`to_hex`] undone; none for anything that isn't hex of UTF-8.
pub fn from_hex(path: &str) -> Option<String> {
    if !path.len().is_multiple_of(2) {
        return None;
    }
    let bytes = (0..path.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(path.get(i..i + 2)?, 16).ok())
        .collect::<Option<Vec<u8>>>()?;
    String::from_utf8(bytes).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_request_for_the_rest_gets_one_chunk() {
        assert_eq!(capped_range(Some("bytes=0-"), 100), "bytes=0-99");
        assert_eq!(capped_range(Some("bytes=1000-"), 100), "bytes=1000-1099");
    }

    #[test]
    fn a_small_range_is_asked_as_it_is() {
        assert_eq!(capped_range(Some("bytes=10-19"), 100), "bytes=10-19");
        assert_eq!(capped_range(Some("bytes=10-500"), 100), "bytes=10-109");
    }

    #[test]
    fn the_end_of_the_file_and_no_range() {
        assert_eq!(capped_range(Some("bytes=-500"), 100), "bytes=-500");
        assert_eq!(capped_range(None, 100), "bytes=0-99");
        assert_eq!(capped_range(Some("items=1-2"), 100), "bytes=0-99");
    }

    #[test]
    fn links_survive_the_path() {
        let link = "https://video.example/a b/clip.mp4?Expires=1&Signature=x~y";
        assert_eq!(from_hex(&to_hex(link)).as_deref(), Some(link));
        assert_eq!(from_hex("zz"), None);
        assert_eq!(from_hex("abc"), None);
    }
}
