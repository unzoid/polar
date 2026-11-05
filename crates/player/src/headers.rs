//! Request headers an add-on asks for with a stream
//! (`behaviorHints.proxyHeaders.request`), as the player sends them.
//!
//! mpv's `http-header-fields` apply to every request while a file plays,
//! subtitles fetched from other hosts included, and the link check follows
//! redirects to other hosts too. So only headers that say who is asking pass
//! (User-Agent, Referer, Origin), never credentials such as Cookie or
//! Authorization; downloads, which go to one link, still send them all.

use std::collections::HashMap;

/// The headers playback passes on, as they are written on the wire.
pub const PASSED: &[&str] = &["User-Agent", "Referer", "Origin"];

/// Longer than any real User-Agent or Referer.
const MAX_VALUE: usize = 1024;

/// The add-on's headers that playback sends, in [`PASSED`] order, names in
/// their usual case. Values with control characters (a line break would start
/// a header of its own) or over 1 KB are left out.
pub fn playback_headers(asked: &HashMap<String, String>) -> Vec<(String, String)> {
    PASSED
        .iter()
        .filter_map(|name| {
            let value = asked.iter().find(|(k, _)| k.trim().eq_ignore_ascii_case(name))?.1.trim();
            let fits = !value.is_empty() && value.len() <= MAX_VALUE && !value.chars().any(|c| c.is_control());
            fits.then(|| (name.to_string(), value.to_string()))
        })
        .collect()
}

/// The same headers as mpv's `http-header-fields` list (`Name: value` each).
pub fn mpv_fields(headers: &[(String, String)]) -> Vec<String> {
    headers.iter().map(|(k, v)| format!("{k}: {v}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn asked(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn passes_who_is_asking_in_a_fixed_order() {
        let h = playback_headers(&asked(&[
            ("referer", "https://site.example/watch"),
            ("user-agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)"),
            ("ORIGIN", "https://site.example"),
        ]));
        let names: Vec<_> = h.iter().map(|(k, _)| k.as_str()).collect();
        assert_eq!(names, ["User-Agent", "Referer", "Origin"]);
        assert_eq!(h[0].1, "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)");
    }

    #[test]
    fn credentials_and_other_headers_stay_behind() {
        let h = playback_headers(&asked(&[("Cookie", "session=1"), ("Authorization", "Bearer x"), ("X-Token", "y")]));
        assert!(h.is_empty());
    }

    #[test]
    fn no_line_breaks_empty_or_huge_values() {
        let long = "a".repeat(MAX_VALUE + 1);
        let h = playback_headers(&asked(&[
            ("User-Agent", "x\r\nCookie: stolen"),
            ("Referer", "  "),
            ("Origin", long.as_str()),
        ]));
        assert!(h.is_empty());
    }

    #[test]
    fn mpv_list_is_name_colon_value() {
        let h = playback_headers(&asked(&[("Referer", " https://site.example/ ")]));
        assert_eq!(mpv_fields(&h), ["Referer: https://site.example/"]);
    }
}
