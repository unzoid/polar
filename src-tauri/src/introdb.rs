//! Skip segments from IntroDB (introdb.app): community-timed intros, recaps,
//! end credits and post-credit scenes, keyed by IMDb id (+ season/episode).
//! Reads are anonymous; "nothing known" is an empty result, never an error.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

const API: &str = "https://api.introdb.app/segments";
/// Community data changes slowly; an hour keeps replays and rewatches free.
const TTL: Duration = Duration::from_secs(60 * 60);

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Span {
    /// Seconds.
    pub start: f64,
    pub end: f64,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Segments {
    pub intro: Option<Span>,
    pub recap: Option<Span>,
    /// End credits.
    pub outro: Option<Span>,
    /// A scene after the credits — don't skip past it.
    pub post_credits: Option<Span>,
}

#[derive(Deserialize)]
struct RawSpan {
    start_sec: f64,
    end_sec: f64,
}

#[derive(Deserialize)]
struct Raw {
    intro: Option<RawSpan>,
    recap: Option<RawSpan>,
    outro: Option<RawSpan>,
    post_credits: Option<RawSpan>,
}

fn span(r: Option<RawSpan>) -> Option<Span> {
    r.filter(|s| s.end_sec > s.start_sec).map(|s| Span { start: s.start_sec, end: s.end_sec })
}

pub struct IntroDb {
    http: reqwest::Client,
    cache: Mutex<HashMap<String, (Instant, Segments)>>,
}

impl Default for IntroDb {
    fn default() -> Self {
        Self {
            http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(10))
                .user_agent(concat!("polar/", env!("CARGO_PKG_VERSION")))
                .build()
                .expect("http client"),
            cache: Mutex::new(HashMap::new()),
        }
    }
}

impl IntroDb {
    /// `video_id` is a movie `tt…` or an episode `tt…:season:episode`.
    pub async fn segments(&self, video_id: &str) -> Result<Segments, String> {
        if let Some((at, hit)) = self.cache.lock().unwrap().get(video_id) {
            if at.elapsed() < TTL {
                return Ok(hit.clone());
            }
        }
        let mut parts = video_id.split(':');
        let Some(imdb) = parts.next().filter(|id| id.starts_with("tt")) else {
            return Ok(Segments::default()); // non-IMDb ids: IntroDB can't know them
        };
        let mut query = vec![("imdb_id", imdb.to_owned())];
        match (parts.next(), parts.next()) {
            (Some(season), Some(episode)) => {
                query.push(("season", season.to_owned()));
                query.push(("episode", episode.to_owned()));
            }
            _ => query.push(("is_movie", "true".to_owned())),
        }

        let res = self.http.get(API).query(&query).send().await.map_err(|e| e.to_string())?;
        let segments = if res.status().is_success() {
            let raw: Raw = res.json().await.map_err(|e| e.to_string())?;
            Segments {
                intro: span(raw.intro),
                recap: span(raw.recap),
                outro: span(raw.outro),
                post_credits: span(raw.post_credits),
            }
        } else if res.status() == reqwest::StatusCode::NOT_FOUND {
            Segments::default()
        } else {
            // Rate limited or down: report, but don't cache, so it's retried next time.
            return Err(format!("IntroDB returned {}", res.status()));
        };
        self.cache.lock().unwrap().insert(video_id.to_owned(), (Instant::now(), segments.clone()));
        Ok(segments)
    }
}
