//! Turn free-text stream rows ("addon\n4k HDR", "💾 12.4 GB 👤 213") into
//! structured quality and a score, so the UI can show *one* good default and a
//! tidy grouped list instead of a wall of emoji.

use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

use crate::types::Stream;

#[derive(Debug, Clone, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct StreamQuality {
    /// Vertical resolution: 2160, 1080, 720, 480 — `None` if unknown.
    pub resolution: Option<u16>,
    pub hdr: bool,
    pub dolby_vision: bool,
    pub codec: Option<&'static str>,
    pub size_bytes: Option<u64>,
    pub sources: Option<u32>,
    /// service-cached (instant start) — usually marked `[RD+]`, `[AD+]`, `⚡`.
    pub cached: bool,
    /// CAM / telesync rips.
    pub low_quality_source: bool,
    /// Plays over plain HTTP (no p2p engine needed).
    pub direct: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RankedStream {
    pub stream: Stream,
    pub addon: String,
    pub quality: StreamQuality,
    pub score: f32,
    /// Short human label, e.g. "4K · HDR · 12.4 GB".
    pub label: String,
}

static RES: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(2160p|4k|uhd|1440p|1080p|720p|576p|480p)\b").unwrap());
static SIZE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(\d+(?:[.,]\d+)?)\s?(TB|GB|MB)\b").unwrap());
static sources: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"👤\s?(\d+)").unwrap());
static HDR: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)\bHDR(10\+?)?\b").unwrap());
static DV: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(DV|DoVi|Dolby\s?Vision)\b").unwrap());
static CACHED: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)(\[(RD|AD|PM|TB|DL|ED|OC)\+\]|⚡|instant)").unwrap());
static CAM: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?i)\b(CAM|CAMRIP|HDCAM|TS|TELESYNC|HDTS|TC)\b").unwrap());

pub fn parse_quality(stream: &Stream) -> StreamQuality {
    let text = [&stream.name, &stream.title, &stream.description]
        .into_iter()
        .flatten()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join(" ");

    let resolution = RES.captures(&text).map(|c| match c[1].to_ascii_lowercase().as_str() {
        "2160p" | "4k" | "uhd" => 2160,
        "1440p" => 1440,
        "1080p" => 1080,
        "720p" => 720,
        "576p" => 576,
        _ => 480,
    });

    let size_bytes = SIZE.captures(&text).and_then(|c| {
        let n: f64 = c[1].replace(',', ".").parse().ok()?;
        let unit = match c[2].to_ascii_uppercase().as_str() {
            "TB" => 1e12,
            "GB" => 1e9,
            _ => 1e6,
        };
        Some((n * unit) as u64)
    });

    let lower = text.to_ascii_lowercase();
    let codec = if lower.contains("av1") {
        Some("AV1")
    } else if ["hevc", "x265", "h265", "h.265"].iter().any(|c| lower.contains(c)) {
        Some("HEVC")
    } else if ["x264", "h264", "h.264", "avc"].iter().any(|c| lower.contains(c)) {
        Some("H.264")
    } else {
        None
    };

    StreamQuality {
        resolution,
        hdr: HDR.is_match(&text),
        dolby_vision: DV.is_match(&text),
        codec,
        size_bytes,
        sources: sources.captures(&text).and_then(|c| c[1].parse().ok()),
        cached: CACHED.is_match(&text),
        low_quality_source: CAM.is_match(&text),
        direct: stream.url.is_some(),
    }
}

/// Higher is better. Deliberately simple and explainable; user preferences
/// (max resolution, avoid HDR on SDR screens, size caps) plug in here later.
pub fn score(q: &StreamQuality) -> f32 {
    let mut s = match q.resolution {
        Some(2160) => 40.0,
        Some(1440) => 37.0,
        Some(1080) => 35.0,
        Some(720) => 22.0,
        Some(_) => 10.0,
        None => 15.0,
    };
    if q.cached {
        s += 30.0; // instant start beats everything except watchability
    }
    if q.direct {
        s += 10.0;
    }
    if let Some(sources) = q.sources {
        s += (sources as f32 + 1.0).log10() * 6.0;
    }
    if q.hdr || q.dolby_vision {
        s += 2.0;
    }
    if q.codec == Some("HEVC") || q.codec == Some("AV1") {
        s += 1.0;
    }
    if let Some(size) = q.size_bytes {
        if size > 40_000_000_000 {
            s -= 12.0; // remux-sized: slow to start for little visible gain
        }
    }
    if q.low_quality_source {
        s -= 100.0;
    }
    s
}

pub fn label(q: &StreamQuality) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(r) = q.resolution {
        parts.push(if r == 2160 { "4K".into() } else { format!("{r}p") });
    }
    if q.dolby_vision {
        parts.push("Dolby Vision".into());
    } else if q.hdr {
        parts.push("HDR".into());
    }
    if let Some(c) = q.codec {
        parts.push(c.into());
    }
    if let Some(b) = q.size_bytes {
        parts.push(if b >= 1_000_000_000 {
            format!("{:.1} GB", b as f64 / 1e9)
        } else {
            format!("{} MB", b / 1_000_000)
        });
    }
    if parts.is_empty() {
        "Unknown quality".into()
    } else {
        parts.join(" · ")
    }
}

/// Rank streams from many addons, best first. Duplicates (same info hash +
/// file, or same URL) collapse to the highest scoring copy.
pub fn rank_streams(streams: impl IntoIterator<Item = (String, Stream)>) -> Vec<RankedStream> {
    let mut ranked: Vec<RankedStream> = streams
        .into_iter()
        .filter(|(_, s)| s.url.is_some() || s.content_id.is_some() || s.yt_id.is_some())
        .map(|(addon, stream)| {
            let quality = parse_quality(&stream);
            RankedStream {
                score: score(&quality),
                label: label(&quality),
                quality,
                addon,
                stream,
            }
        })
        .collect();
    ranked.sort_by(|a, b| b.score.total_cmp(&a.score));

    let mut seen = std::collections::HashSet::new();
    ranked.retain(|r| {
        let key = match (&r.stream.content_id, &r.stream.url) {
            (Some(h), _) => format!("{}:{}", h.to_ascii_lowercase(), r.stream.file_idx.unwrap_or(0)),
            (None, Some(u)) => u.clone(),
            _ => return true,
        };
        seen.insert(key)
    });
    ranked
}

#[cfg(test)]
mod tests {
    use super::*;

    fn stream(name: &str, title: &str) -> Stream {
        Stream {
            name: Some(name.into()),
            title: Some(title.into()),
            content_id: Some("abc".into()),
            ..Default::default()
        }
    }

    #[test]
    fn parses_addon_style_rows() {
        let q = parse_quality(&stream(
            "[RD+] addon\n4k HDR",
            "Show.S01E01.2160p.WEB-DL.DV.HDR.H265\n👤 213 💾 12.4 GB ⚙️ site",
        ));
        assert_eq!(q.resolution, Some(2160));
        assert!(q.hdr && q.dolby_vision && q.cached);
        assert_eq!(q.codec, Some("HEVC"));
        assert_eq!(q.sources, Some(213));
        assert_eq!(q.size_bytes, Some(12_400_000_000));
        assert_eq!(label(&q), "4K · Dolby Vision · HEVC · 12.4 GB");
    }

    #[test]
    fn cams_sink_to_the_bottom() {
        let ranked = rank_streams([
            ("a".into(), stream("addon 1080p", "Movie.2024.HDCAM.x264 👤 900")),
            ("a".into(), Stream { content_id: Some("def".into()), ..stream("addon 720p", "Movie.2024.720p.WEB 👤 12") }),
        ]);
        assert!(ranked[0].label.starts_with("720p"));
    }
}
