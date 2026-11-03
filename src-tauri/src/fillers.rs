//! Filler episodes from animefillerlist.com, for when Jikan (MyAnimeList's
//! filler flags) can't be reached. The site has no API: its show page lists
//! filler as ranges ("33, 50, 64-108") in a `<div class="filler">` block.
//! Fetched here, not in the webview, because the site sends no CORS headers.

use std::time::Duration;

const BASE: &str = "https://www.animefillerlist.com/shows/";

/// Filler episode numbers for the first slug the site knows; empty if none.
pub async fn filler_episodes(slugs: &[String]) -> Vec<u32> {
    let Ok(http) = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(10))
        .user_agent(concat!("polarity/", env!("CARGO_PKG_VERSION")))
        .build()
    else {
        return Vec::new();
    };
    for slug in slugs {
        let valid = !slug.is_empty() && slug.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
        if !valid {
            continue;
        }
        let Ok(res) = http.get(format!("{BASE}{slug}")).send().await else { continue };
        if !res.status().is_success() {
            continue;
        }
        let Ok(html) = res.text().await else { continue };
        if let Some(eps) = parse(&html) {
            return eps;
        }
    }
    Vec::new()
}

/// The filler block's episode numbers, or `None` if the page has no such block.
fn parse(html: &str) -> Option<Vec<u32>> {
    let block = html.split(r#"<div class="filler">"#).nth(1)?;
    let list = block.split(r#"<span class="Episodes">"#).nth(1)?;
    let list = &list[..list.find("</span>")?];
    let mut out = Vec::new();
    // Each range is the text of an <a>: ">64-108</a>".
    for part in list.split("</a>") {
        let Some(text) = part.rsplit('>').next() else { continue };
        let mut ends = text.trim().splitn(2, '-').map(|n| n.trim().parse::<u32>());
        match (ends.next(), ends.next()) {
            (Some(Ok(a)), None) => out.push(a),
            (Some(Ok(a)), Some(Ok(b))) if b >= a && b - a < 2000 => out.extend(a..=b),
            _ => {}
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    #[test]
    fn parses_ranges() {
        let html = r#"<div class="filler"><span class="Label">Filler Episodes:</span><span class="Episodes"><a href="javascript://" onclick="jumpToNum(33);">33</a>, <a href="x">64-66</a></span></div>"#;
        assert_eq!(super::parse(html), Some(vec![33, 64, 65, 66]));
    }
}
