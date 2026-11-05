//! Seek-bar thumbnails from Seekr (seekr.tv) — optional, enabled by an API key.
//!
//! Protocol (mirrors the official `tv.seekr` SDK):
//!  1. `GET api.seekr.tv/sprites` with `X-API-Key` and the title's ids → a signed `vtt_url`.
//!  2. `GET {vtt_url}&st=1` (no key; signed) → WebVTT, one cue per ~10s, each payload a
//!     sprite-sheet URL with an `#xywh=x,y,w,h` fragment. `st=1` asks the server to put
//!     cue times on our playback timeline.
//!
//! "No previews for this title" is a normal outcome and returns `None`, never an error.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::locks::Locked;

const API: &str = "https://api.seekr.tv";
/// Largest thumbnail index read; a long film's is well under 1 MB.
const VTT_MAX: usize = 4 << 20;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cue {
    pub start_ms: u64,
    pub end_ms: u64,
    pub sheet: String,
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewTrack {
    pub cues: Vec<Cue>,
    /// Duration of the release the sprites were made from. `source - played` is the
    /// constant offset to apply when the user plays a slightly different release.
    pub source_duration_ms: u64,
}

#[derive(Deserialize)]
struct Lookup {
    vtt_url: String,
    #[serde(default)]
    source_duration_ms: u64,
}

#[derive(Deserialize)]
struct Validation {
    #[serde(default)]
    valid: bool,
    #[serde(default)]
    tier: Option<String>,
}

pub struct Seekr {
    http: reqwest::Client,
    cache: Mutex<HashMap<String, Option<PreviewTrack>>>,
}

impl Default for Seekr {
    fn default() -> Self {
        Self {
            http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(12))
                .build()
                .expect("http client"),
            cache: Mutex::new(HashMap::new()),
        }
    }
}

impl Seekr {
    /// `video_id` is a movie `tt…` or an episode `tt…:season:episode`.
    pub async fn track(&self, key: &str, video_id: &str, duration_ms: u64) -> Result<Option<PreviewTrack>, String> {
        let cache_key = format!("{video_id}@{}", duration_ms / 1000);
        if let Some(hit) = self.cache.locked().get(&cache_key) {
            return Ok(hit.clone());
        }

        let mut parts = video_id.split(':');
        let imdb = parts.next().filter(|id| id.starts_with("tt")).ok_or("Seekr needs an IMDb id")?;
        let mut query = vec![("duration_ms", duration_ms.to_string())];
        match (parts.next(), parts.next()) {
            (Some(season), Some(episode)) => {
                query.push(("show_imdb_id", imdb.to_owned()));
                query.push(("season", season.to_owned()));
                query.push(("episode", episode.to_owned()));
            }
            _ => query.push(("imdb_id", imdb.to_owned())),
        }

        let res = self
            .http
            .get(format!("{API}/sprites"))
            .header("X-API-Key", key)
            .query(&query)
            .send()
            .await
            .map_err(|e| e.to_string())?;
        let track = match res.status() {
            s if s.is_success() => {
                let lookup: Lookup = res.json().await.map_err(|e| e.to_string())?;
                // Signed URL: deliberately no API key on this request.
                let res = self
                    .http
                    .get(format!("{}&st=1", lookup.vtt_url))
                    .send()
                    .await
                    .and_then(|r| r.error_for_status())
                    .map_err(|e| e.without_url().to_string())?;
                // The URL is Seekr's to give, so its answer is capped like an addon's.
                let vtt = polar_addon::client::read_capped(res, VTT_MAX).await.map_err(|e| e.to_string())?;
                let cues = parse_vtt(&String::from_utf8_lossy(&vtt));
                (!cues.is_empty()).then_some(PreviewTrack { cues, source_duration_ms: lookup.source_duration_ms })
            }
            reqwest::StatusCode::UNAUTHORIZED | reqwest::StatusCode::FORBIDDEN => {
                return Err("Seekr rejected the API key".into())
            }
            _ => None, // 404 etc.: this title simply has no previews
        };
        self.cache.locked().insert(cache_key, track.clone());
        Ok(track)
    }

    /// `Some(tier)` when the key is valid.
    pub async fn validate(&self, key: &str) -> Result<Option<String>, String> {
        let v: Validation = self
            .http
            .get(format!("{API}/v1/keys/validate"))
            .header("X-API-Key", key)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .json()
            .await
            .map_err(|e| e.to_string())?;
        Ok(v.valid.then(|| v.tier.unwrap_or_else(|| "valid".into())))
    }
}

/// Seekr's VTT: timing line, then one payload line `URL#xywh=x,y,w,h`.
fn parse_vtt(vtt: &str) -> Vec<Cue> {
    let mut cues = Vec::new();
    let mut lines = vtt.lines().map(str::trim);
    while let Some(line) = lines.next() {
        let Some((start, end)) = line.split_once("-->") else { continue };
        let Some(payload) = lines.by_ref().find(|l| !l.is_empty()) else { break };
        let Some((sheet, frag)) = payload.rsplit_once("#xywh=") else { continue };
        let n: Vec<u32> = frag.split(',').filter_map(|v| v.trim().parse().ok()).collect();
        if n.len() < 4 {
            continue;
        }
        cues.push(Cue {
            start_ms: parse_time(start.trim()),
            end_ms: parse_time(end.trim()),
            sheet: sheet.to_owned(),
            x: n[0],
            y: n[1],
            w: n[2],
            h: n[3],
        });
    }
    cues.sort_by_key(|c| c.start_ms);
    cues
}

/// `HH:MM:SS.mmm` or `MM:SS.mmm` → ms.
fn parse_time(t: &str) -> u64 {
    let parts: Vec<f64> = t.split(':').filter_map(|p| p.parse().ok()).collect();
    let secs = match parts.as_slice() {
        [h, m, s] => h * 3600.0 + m * 60.0 + s,
        [m, s] => m * 60.0 + s,
        _ => 0.0,
    };
    (secs * 1000.0).round() as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_seekr_vtt() {
        let vtt = "WEBVTT\n\n00:00:00.000 --> 00:00:10.000\nhttps://s/sheet_000.jpg?sig=a#xywh=0,0,320,180\n\n\
                   00:01:10.500 --> 00:01:20.000\nhttps://s/sheet_001.jpg?sig=a#xywh=320,180,320,180\n";
        let cues = parse_vtt(vtt);
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[1].start_ms, 70_500);
        assert_eq!(cues[1].sheet, "https://s/sheet_001.jpg?sig=a");
        assert_eq!((cues[1].x, cues[1].y, cues[1].w, cues[1].h), (320, 180, 320, 180));
    }
}
