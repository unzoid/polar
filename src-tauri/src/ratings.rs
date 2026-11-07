//! Critics' and audience scores from elsewhere (Rotten Tomatoes, Metacritic,
//! Letterboxd, Trakt, TMDB, IMDb), for a title's page, each with a link to
//! the title on that site. Neither source is keyless, so both
//! are opt-in under Settings → Services:
//!
//! * MDBList (mdblist.com) — every score above, one request.
//! * OMDb (omdbapi.com) — Rotten Tomatoes and Metacritic, plus awards.
//!
//! With both keys, MDBList answers and OMDb fills what it left out. "Nothing
//! known" is an empty result, never an error.

use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

use crate::locks::Locked;

/// Scores move slowly; a few hours keeps revisits free and the free tiers' daily limits safe.
const TTL: Duration = Duration::from_secs(6 * 60 * 60);

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ratings {
    /// Tomatometer, percent.
    pub rotten_tomatoes: Option<u32>,
    /// Rotten Tomatoes audience score (Popcornmeter), percent.
    pub audience: Option<u32>,
    /// Metascore, out of 100.
    pub metacritic: Option<u32>,
    /// Out of 5.
    pub letterboxd: Option<f64>,
    /// Percent.
    pub trakt: Option<u32>,
    /// Out of 10.
    pub imdb: Option<f64>,
    pub imdb_votes: Option<u64>,
    /// TMDB user score, percent.
    pub tmdb: Option<u32>,
    /// The title's page on each site with a score, keyed like the fields above
    /// ("rottenTomatoes", "audience", "metacritic", "letterboxd", "trakt", "tmdb", "imdb").
    pub links: BTreeMap<&'static str, String>,
    /// "Won 3 Oscars. 120 wins & 300 nominations total."
    pub awards: Option<String>,
    /// Certification, e.g. "PG-13" or "TV-MA".
    pub rated: Option<String>,
}

impl Ratings {
    fn fill_from(&mut self, o: Ratings) {
        self.rotten_tomatoes = self.rotten_tomatoes.or(o.rotten_tomatoes);
        self.audience = self.audience.or(o.audience);
        self.metacritic = self.metacritic.or(o.metacritic);
        self.letterboxd = self.letterboxd.or(o.letterboxd);
        self.trakt = self.trakt.or(o.trakt);
        self.imdb = self.imdb.or(o.imdb);
        self.imdb_votes = self.imdb_votes.or(o.imdb_votes);
        self.tmdb = self.tmdb.or(o.tmdb);
        for (k, v) in o.links {
            self.links.entry(k).or_insert(v);
        }
        self.awards = self.awards.take().or(o.awards);
        self.rated = self.rated.take().or(o.rated);
    }
}

pub struct RatingsClient {
    http: reqwest::Client,
    cache: Mutex<HashMap<String, (Instant, Ratings)>>,
}

impl Default for RatingsClient {
    fn default() -> Self {
        Self {
            http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(10))
                .build()
                .expect("http client"),
            cache: Mutex::new(HashMap::new()),
        }
    }
}

impl RatingsClient {
    pub async fn get(&self, imdb_id: &str, ty: &str, mdblist: Option<&str>, omdb: Option<&str>) -> Ratings {
        if !imdb_id.starts_with("tt") || (mdblist.is_none() && omdb.is_none()) {
            return Ratings::default();
        }
        let key = format!("{imdb_id}/{}/{}", mdblist.is_some(), omdb.is_some());
        if let Some((at, hit)) = self.cache.locked().get(&key) {
            if at.elapsed() < TTL {
                return hit.clone();
            }
        }
        let (a, b) = tokio::join!(
            async {
                match mdblist {
                    Some(k) => self.mdblist(imdb_id, ty, k).await,
                    None => None,
                }
            },
            async {
                match omdb {
                    Some(k) => self.omdb(imdb_id, k).await,
                    None => None,
                }
            }
        );
        let mut out = a.unwrap_or_default();
        if let Some(b) = b {
            out.fill_from(b);
        }
        if out.imdb.is_some() {
            out.links.insert("imdb", format!("https://www.imdb.com/title/{imdb_id}/"));
        }
        self.cache.locked().insert(key, (Instant::now(), out.clone()));
        out
    }

    /// The answer as JSON, or `None` (logged by host: the query holds the key).
    async fn json(&self, url: &str, query: &[(&str, &str)]) -> Option<Value> {
        let answer = async { self.http.get(url).query(query).send().await?.error_for_status()?.json().await };
        answer
            .await
            .map_err(|e| {
                let host =
                    reqwest::Url::parse(url).ok().and_then(|u| u.host_str().map(str::to_owned)).unwrap_or_default();
                tracing::warn!("ratings from {host} failed: {}", e.without_url());
            })
            .ok()
    }

    async fn mdblist(&self, imdb_id: &str, ty: &str, key: &str) -> Option<Ratings> {
        let series = ty == "series";
        let kind = if series { "show" } else { "movie" };
        // The current API, then the older single endpoint (older keys).
        let v = match self.json(&format!("https://api.mdblist.com/imdb/{kind}/{imdb_id}"), &[("apikey", key)]).await {
            Some(v) if v["ratings"].is_array() => v,
            _ => self.json("https://mdblist.com/api/", &[("apikey", key), ("i", imdb_id)]).await?,
        };
        let mut r = Ratings::default();
        for item in v["ratings"].as_array()? {
            let value = item["value"].as_f64().or_else(|| item["value"].as_str().and_then(|s| s.parse().ok()));
            let Some(value) = value.filter(|v| *v > 0.0) else { continue };
            let pct = || Some(value.round().clamp(0.0, 100.0) as u32);
            // The site's path for the title ("/m/heat_1995"), where MDBList knows it.
            let path = item["url"].as_str().filter(|p| p.starts_with('/'));
            let mut link = |field: &'static str, base: &str| {
                if let Some(p) = path {
                    r.links.insert(field, format!("{base}{p}"));
                }
            };
            match item["source"].as_str().unwrap_or_default() {
                "tomatoes" => {
                    link("rottenTomatoes", "https://www.rottentomatoes.com");
                    r.rotten_tomatoes = pct();
                }
                "popcorn" | "tomatoesaudience" => {
                    link("audience", "https://www.rottentomatoes.com");
                    r.audience = pct();
                }
                "metacritic" => {
                    link("metacritic", if series { "https://www.metacritic.com/tv" } else { "https://www.metacritic.com/movie" });
                    r.metacritic = pct();
                }
                "letterboxd" => {
                    link("letterboxd", "https://letterboxd.com");
                    r.letterboxd = Some(value);
                }
                "trakt" => r.trakt = pct(),
                "tmdb" => r.tmdb = pct(),
                "imdb" => {
                    r.imdb = Some(value);
                    r.imdb_votes = item["votes"].as_u64().filter(|n| *n > 0);
                }
                _ => {}
            }
        }
        if r.trakt.is_some() {
            r.links.insert("trakt", format!("https://app.trakt.tv/{}/{imdb_id}", if series { "shows" } else { "movies" }));
        }
        if let Some(id) = v["ids"]["tmdb"].as_u64().filter(|_| r.tmdb.is_some()) {
            r.links.insert("tmdb", format!("https://www.themoviedb.org/{}/{id}", if series { "tv" } else { "movie" }));
        }
        r.rated = v["certification"].as_str().filter(|s| !s.is_empty()).map(str::to_owned);
        Some(r)
    }

    async fn omdb(&self, imdb_id: &str, key: &str) -> Option<Ratings> {
        let v = self.json("https://www.omdbapi.com/", &[("apikey", key), ("i", imdb_id)]).await?;
        if v["Response"] == "False" {
            return None;
        }
        let text = |k: &str| v[k].as_str().filter(|s| !s.is_empty() && *s != "N/A").map(str::to_owned);
        let mut r = Ratings {
            imdb: text("imdbRating").and_then(|s| s.parse().ok()),
            imdb_votes: text("imdbVotes").and_then(|s| s.replace(',', "").parse().ok()),
            awards: text("Awards"),
            rated: text("Rated"),
            metacritic: text("Metascore").and_then(|s| s.parse().ok()),
            ..Default::default()
        };
        for item in v["Ratings"].as_array().into_iter().flatten() {
            let value = item["Value"].as_str().unwrap_or_default();
            match item["Source"].as_str() {
                Some("Rotten Tomatoes") => r.rotten_tomatoes = value.trim_end_matches('%').parse().ok(),
                Some("Metacritic") => r.metacritic = r.metacritic.or_else(|| value.split('/').next()?.parse().ok()),
                _ => {}
            }
        }
        Some(r)
    }
}
