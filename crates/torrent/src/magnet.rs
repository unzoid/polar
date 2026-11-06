//! What an add-on's torrent stream names (`infoHash`, `fileIdx`, `sources`),
//! checked and turned into the magnet link the engine opens.

/// The most trackers taken from one stream: enough for any real list, and an
/// add-on can't make the engine contact hundreds of hosts.
const MAX_TRACKERS: usize = 20;

/// A 40-character hex info hash, lower case, from hex or the 32-character
/// base32 form; `None` for anything else.
pub fn info_hash(raw: &str) -> Option<String> {
    let raw = raw.trim();
    if raw.len() == 40 && raw.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Some(raw.to_ascii_lowercase());
    }
    if raw.len() == 32 {
        let mut bits: u64 = 0;
        let mut n = 0;
        let mut out = String::with_capacity(40);
        for b in raw.bytes() {
            let v = match b.to_ascii_uppercase() {
                c @ b'A'..=b'Z' => c - b'A',
                c @ b'2'..=b'7' => c - b'2' + 26,
                _ => return None,
            };
            bits = (bits << 5) | u64::from(v);
            n += 5;
            while n >= 4 {
                n -= 4;
                out.push(char::from_digit(((bits >> n) & 0xf) as u32, 16).unwrap_or('0'));
            }
        }
        return Some(out);
    }
    None
}

/// The trackers among a stream's `sources` (`tracker:<url>`): http, https and
/// udp announce links only, at most [`MAX_TRACKERS`], each once.
pub fn trackers(sources: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for s in sources {
        let Some(url) = s.strip_prefix("tracker:") else { continue };
        let url = url.trim();
        let scheme = url.split_once("://").map(|(s, _)| s.to_ascii_lowercase());
        if !matches!(scheme.as_deref(), Some("http" | "https" | "udp")) || url.chars().any(char::is_whitespace) {
            continue;
        }
        if !out.iter().any(|t| t == url) {
            out.push(url.to_owned());
        }
        if out.len() == MAX_TRACKERS {
            break;
        }
    }
    out
}

/// `magnet:?xt=urn:btih:<hash>` with the trackers as `tr` parameters.
pub fn magnet(info_hash: &str, trackers: &[String]) -> String {
    let mut link = format!("magnet:?xt=urn:btih:{info_hash}");
    for t in trackers {
        link.push_str("&tr=");
        link.push_str(&percent_encode(t));
    }
    link
}

fn percent_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_and_base32_hashes() {
        let hex = "0123456789ABCDEF0123456789abcdef01234567";
        assert_eq!(info_hash(hex).as_deref(), Some("0123456789abcdef0123456789abcdef01234567"));
        // The same 20 bytes in base32.
        assert_eq!(
            info_hash("AERUKZ4JVPG66AJDIVTYTK6N54ASGRLH").as_deref(),
            Some("0123456789abcdef0123456789abcdef01234567")
        );
        assert_eq!(info_hash("xyz"), None);
        assert_eq!(info_hash(&"g".repeat(40)), None);
        assert_eq!(info_hash("AERUKZ4JVPG66AJDIVTYTK6N54ASGRL1"), None);
    }

    #[test]
    fn only_tracker_sources_with_web_or_udp_links() {
        let sources: Vec<String> = [
            "tracker:udp://tracker.example.org:1337/announce",
            "tracker:https://tracker.example.com/announce",
            "tracker:udp://tracker.example.org:1337/announce",
            "dht:0123456789abcdef0123456789abcdef01234567",
            "tracker:file:///etc/passwd",
            "tracker:http://bad host.invalid/announce",
            "https://media.example.com/film.mkv",
        ]
        .map(String::from)
        .to_vec();
        assert_eq!(
            trackers(&sources),
            ["udp://tracker.example.org:1337/announce", "https://tracker.example.com/announce"]
        );
    }

    #[test]
    fn trackers_are_capped() {
        let sources: Vec<String> = (0..50).map(|i| format!("tracker:udp://t{i}.example.org:80/announce")).collect();
        assert_eq!(trackers(&sources).len(), MAX_TRACKERS);
    }

    #[test]
    fn magnet_link_encodes_trackers() {
        let link =
            magnet("0123456789abcdef0123456789abcdef01234567", &["udp://tracker.example.org:1337/announce".into()]);
        assert_eq!(
            link,
            "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&tr=udp%3A%2F%2Ftracker.example.org%3A1337%2Fannounce"
        );
    }
}
