//! Primary source: TMDB, normalised to IMDb-keyed addon types.
//!
//! TMDB list endpoints don't include IMDb ids or logos, so each result is
//! resolved by one details request carrying both (`external_ids` and `images`
//! appended), a few at a time. Answers are cached for a day, so only the first
//! view of a catalog pays for it. A catalog is one list
//! read on page by page as `skip` grows ([`Run`]), so titles left out for
//! lacking an IMDb id or repeated by a drifting list never shift later pages.

use std::collections::HashSet;
use std::sync::Arc;
use std::time::Duration;

use futures::stream::{self, StreamExt, TryStreamExt};
use polar_addon::{Meta, MetaDetails, MetaPreview, Person, Video};
use serde::Deserialize;
use serde_json::Value;
use tokio::sync::{Mutex, Semaphore};

use crate::cache::TtlCache;
use crate::{curate, IndexError, Result, PAGE_SIZE};

const API: &str = "https://api.themoviedb.org/3";
const IMG: &str = "https://image.tmdb.org/t/p";
/// Requests to TMDB in flight at once, across every shelf: Home opens about a
/// dozen catalogs together, each needing 20 lookups.
const IN_FLIGHT: usize = 12;
/// Tries per request when TMDB answers 429 or a 5xx.
const TRIES: u32 = 4;
/// Longest wait between tries, whatever `Retry-After` asks for.
const MAX_WAIT: Duration = Duration::from_secs(8);
/// TMDB serves at most this many pages of a list.
const LAST_PAGE: u32 = 500;

pub struct Tmdb {
    http: reqwest::Client,
    /// [`API`], or a local stand-in in tests.
    api: String,
    key: String,
    language: String,
    limit: Semaphore,
    /// Per TMDB id: its IMDb id (none: left out of lists) and title logo.
    lookups: TtlCache<(char, u64), Lookup>,
    /// One growing list per catalog (type, id, genre), so a page asked for by
    /// `skip` is a slice of the same sequence whatever the earlier pages held.
    runs: TtlCache<String, Arc<Mutex<Run>>>,
}

type Query = Vec<(String, String)>;

/// A catalog read page by page. Titles without an IMDb id are left out, so a
/// TMDB page gives 20 or fewer; `skip` counts the titles kept, not pages.
struct Run {
    path: String,
    query: Query,
    next_page: u32,
    done: bool,
    items: Vec<MetaPreview>,
    seen: HashSet<String>,
}

impl Tmdb {
    pub fn new(key: String, language: Option<String>) -> Self {
        Self {
            http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(15))
                .build()
                .expect("http client"),
            api: API.to_owned(),
            key: key.trim().to_owned(),
            language: language.unwrap_or_else(|| "en-US".into()),
            limit: Semaphore::new(IN_FLIGHT),
            lookups: TtlCache::new(Duration::from_secs(24 * 60 * 60), 20_000),
            runs: TtlCache::new(Duration::from_secs(60 * 60), 256),
        }
    }

    /// One TMDB request: at most [`IN_FLIGHT`] at a time, 429 and 5xx tried
    /// again after `Retry-After` (or 1, 2, 4 s). Errors never carry the URL,
    /// which holds a v3 key.
    async fn get<T: serde::de::DeserializeOwned>(&self, path: &str, query: &[(&str, &str)]) -> Result<T> {
        let mut attempt = 0;
        loop {
            attempt += 1;
            let res = {
                let _permit = self.limit.acquire().await.map_err(|_| IndexError::Upstream("closed".into()))?;
                let mut req = self
                    .http
                    .get(format!("{}{path}", self.api))
                    .query(&[("language", self.language.as_str())])
                    .query(query);
                // v4 read tokens are JWTs; v3 keys are 32 hex chars.
                req = if self.key.starts_with("eyJ") {
                    req.bearer_auth(&self.key)
                } else {
                    req.query(&[("api_key", self.key.as_str())])
                };
                req.send().await?
            };
            let status = res.status();
            if status == reqwest::StatusCode::NOT_FOUND {
                return Err(IndexError::NotFound);
            }
            if (status == reqwest::StatusCode::TOO_MANY_REQUESTS || status.is_server_error()) && attempt < TRIES {
                tokio::time::sleep(retry_wait(res.headers().get(reqwest::header::RETRY_AFTER), attempt)).await;
                continue;
            }
            return Ok(res.error_for_status()?.json().await?);
        }
    }

    /// `skip` titles in, up to [`PAGE_SIZE`] of them; fewer at the end of the
    /// list, or when the page after them failed.
    pub async fn catalog(&self, ty: &str, id: &str, skip: u32, genre: Option<&str>) -> Result<Vec<MetaPreview>> {
        let key = format!("{ty}/{id}/{}", genre.unwrap_or(""));
        let (path, query, first_page) = list_request(ty, id, genre)?;
        let run = self.runs.get_or_insert_with(key, || {
            Arc::new(Mutex::new(Run {
                path,
                query,
                next_page: first_page,
                done: false,
                items: Vec::new(),
                seen: HashSet::new(),
            }))
        });
        // Held while reading on, so two asks for the same catalog fetch once.
        let mut run = run.lock().await;
        let want = skip as usize + PAGE_SIZE as usize;
        while run.items.len() < want && !run.done {
            let page = run.next_page.to_string();
            let mut query: Vec<(&str, &str)> = run.query.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
            query.push(("page", &page));
            // A failed page (or lookup in it) leaves the run where it was. What
            // is already read past `skip` is still handed out: a short page,
            // and the next ask (`skip` = titles so far) tries the page again.
            let fetched = match self.get::<Paged>(&run.path, &query).await {
                Ok(list) => {
                    let last = list.results.is_empty() || run.next_page >= list.total_pages.min(LAST_PAGE);
                    self.previews(ty, list.results).await.map(|p| (p, last))
                }
                Err(e) => Err(e),
            };
            let (previews, last) = match fetched {
                Ok(page) => page,
                Err(_) if run.items.len() > skip as usize => break,
                Err(e) => return Err(e),
            };
            let run = &mut *run;
            for p in previews {
                if run.seen.insert(p.id.clone()) {
                    run.items.push(p);
                }
            }
            run.next_page += 1;
            run.done = last;
        }
        Ok(run.items.iter().skip(skip as usize).take(PAGE_SIZE as usize).cloned().collect())
    }

    /// TMDB's own "if you liked this" list, falling back to plain similarity.
    pub async fn recommendations(&self, ty: &str, imdb_id: &str) -> Result<Vec<MetaPreview>> {
        let tmdb_id = self.find(ty, imdb_id).await?;
        let kind = tmdb_kind(ty);
        let mut list: Paged = self.get(&format!("/{kind}/{tmdb_id}/recommendations"), &[]).await?;
        if list.results.len() < 6 {
            let similar: Paged = self.get(&format!("/{kind}/{tmdb_id}/similar"), &[]).await?;
            list.results.extend(similar.results);
        }
        Ok(curate::dedupe(self.previews(ty, list.results).await?))
    }

    async fn find(&self, ty: &str, imdb_id: &str) -> Result<u64> {
        let found: Value = self.get(&format!("/find/{imdb_id}"), &[("external_source", "imdb_id")]).await?;
        let bucket = if ty == "series" { "tv_results" } else { "movie_results" };
        found[bucket][0]["id"].as_u64().ok_or(IndexError::NotFound)
    }

    /// A search, narrowed to titles released in `year` (any region's release
    /// for films) when one is given.
    pub async fn search(&self, ty: &str, query: &str, year: Option<u16>) -> Result<Vec<MetaPreview>> {
        let path = format!("/search/{}", tmdb_kind(ty));
        let year = year.map(|y| y.to_string());
        let mut params = vec![("query", query)];
        if let Some(y) = &year {
            params.push((if ty == "series" { "first_air_date_year" } else { "year" }, y));
        }
        let list: Paged = self.get(&path, &params).await?;
        self.previews(ty, list.results).await
    }

    /// List results with their IMDb ids and logos; titles TMDB has no IMDb id
    /// for are left out. Any lookup that fails fails the whole list, so a
    /// thinned list is never cached.
    async fn previews(&self, ty: &str, items: Vec<Item>) -> Result<Vec<MetaPreview>> {
        // By value, not `&Item`: a closure over a borrow makes the future not
        // `Send` enough for axum (rust-lang/rust#64552).
        let tmdb_ids: Vec<u64> = items.iter().map(|item| item.id).collect();
        let found: Vec<Lookup> =
            stream::iter(tmdb_ids).map(|id| self.lookup(ty, id)).buffered(IN_FLIGHT).try_collect().await?;
        Ok(items
            .into_iter()
            .zip(found)
            .filter_map(|(item, found)| Some(item.into_preview(ty, found.imdb_id?, found.logos)))
            .collect())
    }

    /// A list result's IMDb id and logos, from one details request with only
    /// English and language-free images, as [`Tmdb::meta`] picks its logo.
    async fn lookup(&self, ty: &str, tmdb_id: u64) -> Result<Lookup> {
        let key = (ty.chars().next().unwrap_or('m'), tmdb_id);
        if let Some(hit) = self.lookups.get(&key) {
            return Ok(hit);
        }
        let d: Value = self
            .get(
                &format!("/{}/{tmdb_id}", tmdb_kind(ty)),
                &[("append_to_response", "external_ids,images"), ("include_image_language", "en,null")],
            )
            .await?;
        let found = Lookup {
            imdb_id: str_of(&d["external_ids"]["imdb_id"]).filter(|i| i.starts_with("tt")),
            logos: pick_logos(&d["images"]["logos"]),
        };
        self.lookups.insert(key, found.clone());
        Ok(found)
    }

    /// The IMDb id of TMDB's title `tmdb_id`, if TMDB lists one ("Open in Polarity" from a TMDB
    /// page, #208). The same cached details request as list results.
    pub async fn imdb_of(&self, ty: &str, tmdb_id: u64) -> Result<Option<String>> {
        Ok(self.lookup(ty, tmdb_id).await?.imdb_id)
    }

    pub async fn meta(&self, ty: &str, imdb_id: &str) -> Result<Meta> {
        let tmdb_id = self.find(ty, imdb_id).await?;
        let kind = tmdb_kind(ty);

        let d: Value = self
            .get(
                &format!("/{kind}/{tmdb_id}"),
                &[("append_to_response", "credits,videos,images"), ("include_image_language", "en,null")],
            )
            .await?;

        let videos = if ty == "series" { self.episodes(tmdb_id, imdb_id, &d).await? } else { Vec::new() };
        Ok(detail_to_meta(ty, imdb_id, &d, videos))
    }

    /// All seasons, 20 per request via `append_to_response=season/N,...`.
    async fn episodes(&self, tmdb_id: u64, imdb_id: &str, detail: &Value) -> Result<Vec<Video>> {
        let seasons: Vec<u64> = detail["seasons"]
            .as_array()
            .map(|s| s.iter().filter_map(|s| s["season_number"].as_u64()).collect())
            .unwrap_or_default();

        let requests = seasons.chunks(20).map(|chunk| {
            let append = chunk.iter().map(|n| format!("season/{n}")).collect::<Vec<_>>().join(",");
            async move {
                self.get::<Value>(&format!("/tv/{tmdb_id}"), &[("append_to_response", &append)])
                    .await
                    .map(|v| (chunk.to_vec(), v))
            }
        });

        let mut videos = Vec::new();
        for result in futures::future::join_all(requests).await {
            let (chunk, value) = result?;
            for n in chunk {
                let Some(eps) = value[format!("season/{n}")]["episodes"].as_array() else { continue };
                for ep in eps {
                    let (Some(season), Some(episode)) = (ep["season_number"].as_u64(), ep["episode_number"].as_u64())
                    else {
                        continue;
                    };
                    videos.push(Video {
                        id: format!("{imdb_id}:{season}:{episode}"),
                        title: str_of(&ep["name"]).unwrap_or_else(|| format!("Episode {episode}")),
                        season: season as u32,
                        episode: episode as u32,
                        released: str_of(&ep["air_date"]),
                        thumbnail: str_of(&ep["still_path"]).map(|p| format!("{IMG}/w400{p}")),
                        overview: str_of(&ep["overview"]),
                        rating: ep["vote_average"].as_f64().filter(|r| *r > 0.0).map(|r| format!("{r:.1}")),
                    });
                }
            }
        }
        videos.sort_by_key(|v| (v.season, v.episode));
        Ok(videos)
    }
}

/// The list endpoint behind a catalog, its query and the page to start on.
/// The curated shelves are `/discover` queries; gems and classics start on a
/// page that rotates daily, so they don't open on the same titles.
fn list_request(ty: &str, id: &str, genre: Option<&str>) -> Result<(String, Query, u32)> {
    let kind = tmdb_kind(ty);
    let genre = genre.map(|name| genre_id(ty, name).ok_or(IndexError::NotFound)).transpose()?;
    let pair = |k: &str, v: &str| (k.to_owned(), v.to_owned());
    if matches!(id, "new" | "gems" | "classics") {
        let day = curate::today();
        let date_field = if ty == "series" { "first_air_date" } else { "primary_release_date" };
        let mut query = match id {
            "new" => vec![
                pair(&format!("{date_field}.gte"), &curate::date(day.saturating_sub(240))),
                pair(&format!("{date_field}.lte"), &curate::date(day)),
                pair("sort_by", "popularity.desc"),
                pair("vote_count.gte", "25"),
            ],
            "gems" => vec![
                pair("sort_by", "vote_average.desc"),
                pair("vote_average.gte", "7.3"),
                pair("vote_count.gte", "150"),
                pair("vote_count.lte", "2500"),
            ],
            _ => vec![
                pair(&format!("{date_field}.lte"), "2009-12-31"),
                pair("sort_by", "vote_average.desc"),
                pair("vote_count.gte", if ty == "series" { "400" } else { "1500" }),
            ],
        };
        let offset = match id {
            "gems" => day % 4,
            "classics" => day % 6,
            _ => 0,
        } as u32;
        if let Some(g) = genre {
            query.push(pair("with_genres", &g.to_string()));
        }
        return Ok((format!("/discover/{kind}"), query, 1 + offset));
    }
    if let Some(g) = genre {
        let (sort, min_votes) = if id == "top_rated" { ("vote_average.desc", "300") } else { ("popularity.desc", "0") };
        let query = vec![pair("with_genres", &g.to_string()), pair("sort_by", sort), pair("vote_count.gte", min_votes)];
        return Ok((format!("/discover/{kind}"), query, 1));
    }
    let path = match id {
        "trending" => format!("/trending/{kind}/week"),
        "top_rated" => format!("/{kind}/top_rated"),
        "popular" => format!("/{kind}/popular"),
        _ => return Err(IndexError::NotFound),
    };
    Ok((path, Vec::new(), 1))
}

/// How long to wait before try `attempt + 1`: TMDB's `Retry-After` seconds
/// when it sends them, else 1, 2, 4 s; never more than [`MAX_WAIT`].
fn retry_wait(retry_after: Option<&reqwest::header::HeaderValue>, attempt: u32) -> Duration {
    let asked = retry_after.and_then(|v| v.to_str().ok()).and_then(|v| v.trim().parse::<u64>().ok());
    let wait = asked.map(Duration::from_secs).unwrap_or(Duration::from_secs(1 << (attempt - 1).min(3)));
    wait.min(MAX_WAIT)
}

/// Cinemeta-style genre names → TMDB genre ids (movie and TV lists differ).
fn genre_id(ty: &str, name: &str) -> Option<u32> {
    let movie = ty != "series";
    Some(match (name.to_ascii_lowercase().as_str(), movie) {
        ("action", true) => 28,
        ("action", false) | ("adventure", false) => 10759,
        ("adventure", true) => 12,
        ("animation", _) => 16,
        ("comedy", _) => 35,
        ("crime", _) => 80,
        ("documentary", _) => 99,
        ("drama", _) => 18,
        ("family", _) => 10751,
        ("fantasy", true) => 14,
        ("fantasy", false) | ("sci-fi", false) => 10765,
        ("history", true) => 36,
        ("horror", true) => 27,
        ("music", true) => 10402,
        ("mystery", _) => 9648,
        ("romance", true) => 10749,
        ("sci-fi", true) => 878,
        ("thriller", true) => 53,
        ("war", true) => 10752,
        ("war", false) => 10768,
        ("western", _) => 37,
        _ => return None,
    })
}

/// Cinemeta-style names [`genre_id`] knows, in the order a name is picked when ids are shared.
const GENRE_NAMES: [&str; 18] = [
    "Action",
    "Adventure",
    "Animation",
    "Comedy",
    "Crime",
    "Documentary",
    "Drama",
    "Family",
    "Fantasy",
    "Sci-Fi",
    "History",
    "Horror",
    "Music",
    "Mystery",
    "Romance",
    "Thriller",
    "War",
    "Western",
];

/// TMDB genre id → its Cinemeta-style name, the reverse of [`genre_id`]: search results name their
/// genres only by id, and the app tells animation by name (re-test 28: a typo search's retry).
fn genre_name(ty: &str, id: u32) -> Option<&'static str> {
    GENRE_NAMES.into_iter().find(|n| genre_id(ty, n) == Some(id))
}

fn tmdb_kind(ty: &str) -> &'static str {
    if ty == "series" {
        "tv"
    } else {
        "movie"
    }
}

fn str_of(v: &Value) -> Option<String> {
    v.as_str().filter(|s| !s.is_empty()).map(str::to_owned)
}

fn year(date: &Value) -> Option<String> {
    date.as_str().and_then(|d| d.get(..4)).map(str::to_owned)
}

/// The YouTube key of a title's best video from TMDB's `videos`: an official
/// trailer, then any trailer, then a teaser.
fn pick_trailer(videos: &[Value]) -> Option<String> {
    let youtube = |v: &&Value| v["site"] == "YouTube" && str_of(&v["key"]).is_some();
    let rank = |v: &Value| match (v["type"].as_str(), v["official"].as_bool().unwrap_or(false)) {
        (Some("Trailer"), true) => 0,
        (Some("Trailer"), false) => 1,
        (Some("Teaser"), _) => 2,
        _ => 3,
    };
    videos.iter().filter(youtube).filter(|v| rank(v) < 3).min_by_key(|v| rank(v)).and_then(|v| str_of(&v["key"]))
}

/// The logos from a details answer's `images.logos` (asked for as English or
/// language-free only), English first, each group in TMDB's order. The first
/// is the title's logo; the app may choose another that reads better on the
/// backdrop (#215).
fn pick_logos(logos: &Value) -> Vec<String> {
    let Some(logos) = logos.as_array() else { return Vec::new() };
    let english = logos.iter().filter(|l| l["iso_639_1"] == "en");
    let others = logos.iter().filter(|l| l["iso_639_1"] != "en");
    english
        .chain(others)
        .filter_map(|l| str_of(&l["file_path"]))
        .map(|p| format!("{IMG}/w500{p}"))
        .take(MAX_LOGOS)
        .collect()
}

/// More logos than this aren't kept: the app measures at most a few.
const MAX_LOGOS: usize = 6;

fn detail_to_meta(ty: &str, imdb_id: &str, d: &Value, videos: Vec<Video>) -> Meta {
    let is_series = ty == "series";
    let release_info = if is_series {
        let start = year(&d["first_air_date"]);
        let ended = matches!(d["status"].as_str(), Some("Ended" | "Canceled"));
        let end = if ended { year(&d["last_air_date"]) } else { None };
        start.map(|s| match end {
            Some(e) if e != s => format!("{s}–{e}"),
            Some(_) => s,
            None => format!("{s}–"),
        })
    } else {
        year(&d["release_date"])
    };

    let logos = pick_logos(&d["images"]["logos"]);

    let runtime = d["runtime"]
        .as_u64()
        .or_else(|| d["episode_run_time"][0].as_u64())
        .filter(|m| *m > 0)
        .map(|m| format!("{m} min"));

    let names = |v: &Value, take: usize| -> Vec<String> {
        v.as_array().map(|a| a.iter().filter_map(|p| str_of(&p["name"])).take(take).collect()).unwrap_or_default()
    };
    let director = if is_series {
        names(&d["created_by"], 3)
    } else {
        d["credits"]["crew"]
            .as_array()
            .map(|crew| crew.iter().filter(|c| c["job"] == "Director").filter_map(|c| str_of(&c["name"])).collect())
            .unwrap_or_default()
    };

    let trailer_yt_id = d["videos"]["results"].as_array().map(Vec::as_slice).and_then(pick_trailer);

    let people = d["credits"]["cast"]
        .as_array()
        .map(|cast| {
            cast.iter()
                .filter_map(|p| {
                    Some(Person {
                        name: str_of(&p["name"])?,
                        character: str_of(&p["character"]).or_else(|| str_of(&p["roles"][0]["character"])),
                        photo: str_of(&p["profile_path"]).map(|path| format!("{IMG}/w185{path}")),
                    })
                })
                .take(24)
                .collect()
        })
        .unwrap_or_default();
    let list = |v: &Value, key: &str, take: usize| -> Vec<String> {
        v.as_array().map(|a| a.iter().filter_map(|x| str_of(&x[key])).take(take).collect()).unwrap_or_default()
    };
    let writers: Vec<String> = d["credits"]["crew"]
        .as_array()
        .map(|crew| {
            let mut names: Vec<String> = Vec::new();
            for c in
                crew.iter().filter(|c| matches!(c["job"].as_str(), Some("Screenplay" | "Writer" | "Story" | "Novel")))
            {
                if let Some(n) = str_of(&c["name"]).filter(|n| !names.contains(n)) {
                    names.push(n);
                }
            }
            names.into_iter().take(4).collect()
        })
        .unwrap_or_default();
    let mut countries = list(&d["production_countries"], "name", 3);
    if countries.is_empty() {
        countries = d["origin_country"].as_array().map(|a| a.iter().filter_map(str_of).collect()).unwrap_or_default();
    }
    let positive = |v: &Value| v.as_u64().filter(|n| *n > 0);
    let details = MetaDetails {
        tagline: str_of(&d["tagline"]),
        status: str_of(&d["status"]),
        released: str_of(&d["release_date"]).or_else(|| str_of(&d["first_air_date"])),
        countries,
        languages: list(&d["spoken_languages"], "english_name", 4),
        original_language: str_of(&d["original_language"]),
        studios: if is_series { list(&d["networks"], "name", 3) } else { list(&d["production_companies"], "name", 3) },
        writers,
        awards: None,
        budget: positive(&d["budget"]),
        revenue: positive(&d["revenue"]),
        seasons: positive(&d["number_of_seasons"]).map(|n| n as u32),
        episodes: positive(&d["number_of_episodes"]).map(|n| n as u32),
        votes: positive(&d["vote_count"]),
        tmdb_id: d["id"].as_u64(),
    };

    Meta {
        people,
        details,
        preview: MetaPreview {
            id: imdb_id.into(),
            ty: ty.into(),
            name: str_of(&d["title"]).or_else(|| str_of(&d["name"])).unwrap_or_default(),
            poster: str_of(&d["poster_path"]).map(|p| format!("{IMG}/w500{p}")),
            background: str_of(&d["backdrop_path"]).map(|p| format!("{IMG}/original{p}")),
            logo: logos.first().cloned(),
            logos,
            description: str_of(&d["overview"]),
            release_info,
            imdb_rating: d["vote_average"].as_f64().filter(|r| *r > 0.0).map(|r| format!("{r:.1}")),
            genres: names(&d["genres"], 4),
        },
        runtime,
        cast: names(&d["credits"]["cast"], 10),
        director,
        trailer_source: trailer_yt_id.as_ref().map(|_| "tmdb".to_string()),
        trailer_yt_id,
        videos,
    }
}

#[derive(Deserialize)]
struct Paged {
    #[serde(default)]
    results: Vec<Item>,
    #[serde(default = "one")]
    total_pages: u32,
}

fn one() -> u32 {
    1
}

#[derive(Deserialize)]
struct Item {
    id: u64,
    title: Option<String>,
    name: Option<String>,
    poster_path: Option<String>,
    backdrop_path: Option<String>,
    overview: Option<String>,
    release_date: Option<String>,
    first_air_date: Option<String>,
    vote_average: Option<f64>,
    /// Lists and searches name genres only by id.
    #[serde(default)]
    genre_ids: Vec<u32>,
}

impl Item {
    fn into_preview(self, ty: &str, imdb_id: String, logos: Vec<String>) -> MetaPreview {
        MetaPreview {
            id: imdb_id,
            ty: ty.into(),
            name: self.title.or(self.name).unwrap_or_default(),
            poster: self.poster_path.map(|p| format!("{IMG}/w342{p}")),
            background: self.backdrop_path.map(|p| format!("{IMG}/w1280{p}")),
            logo: logos.first().cloned(),
            logos,
            description: self.overview.filter(|o| !o.is_empty()),
            release_info: self.release_date.or(self.first_air_date).and_then(|d| d.get(..4).map(str::to_owned)),
            imdb_rating: self.vote_average.filter(|r| *r > 0.0).map(|r| format!("{r:.1}")),
            genres: self.genre_ids.iter().filter_map(|&g| genre_name(ty, g)).map(str::to_owned).collect(),
        }
    }
}

#[derive(Clone)]
struct Lookup {
    imdb_id: Option<String>,
    logos: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    /// A stand-in for TMDB on 127.0.0.1. `/movie/popular`: 3 pages of 20,
    /// page 2 repeating two titles of page 1 (lists drift as popularity
    /// moves), page 1 refused once with 429. Details: no IMDb id for multiples
    /// of 5, a 500 every time for 305; even ids have logos (a Spanish one
    /// listed before the English one), odd ids none.
    async fn fake_tmdb() -> (String, Arc<AtomicUsize>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let hits = Arc::new(AtomicUsize::new(0));
        let counter = hits.clone();
        tokio::spawn(async move {
            let refused = Arc::new(AtomicUsize::new(0));
            loop {
                let (mut sock, _) = listener.accept().await.unwrap();
                let (counter, refused) = (counter.clone(), refused.clone());
                tokio::spawn(async move {
                    let mut buf = vec![0; 4096];
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    let head = String::from_utf8_lossy(&buf[..n]);
                    let target = head.split_whitespace().nth(1).unwrap_or("").to_owned();
                    let (path, query) = target.split_once('?').unwrap_or((&target, ""));
                    let page: u64 = query
                        .split('&')
                        .find_map(|kv| kv.strip_prefix("page="))
                        .and_then(|p| p.parse().ok())
                        .unwrap_or(1);
                    counter.fetch_add(1, Ordering::SeqCst);
                    let (status, body) = if path == "/search/movie" {
                        // A year narrows the search to one of its three films.
                        let ids: &[u64] = if query.contains("year=2001") { &[401] } else { &[401, 402, 403] };
                        let results: Vec<Value> =
                            ids.iter().map(|id| json!({ "id": id, "title": format!("T{id}") })).collect();
                        ("200 OK", json!({ "results": results }).to_string())
                    } else if path == "/movie/popular" {
                        if page == 1 && refused.fetch_add(1, Ordering::SeqCst) == 0 {
                            ("429 Too Many Requests", String::new())
                        } else {
                            let mut ids: Vec<u64> = (0..20).map(|i| page * 100 + i).collect();
                            if page == 2 {
                                ids[0] = 101;
                                ids[1] = 102;
                            }
                            let results: Vec<Value> =
                                ids.iter().map(|id| json!({ "id": id, "title": format!("T{id}") })).collect();
                            ("200 OK", json!({ "results": results, "total_pages": 3 }).to_string())
                        }
                    } else if let Some(id) = path.strip_prefix("/movie/").and_then(|id| id.parse::<u64>().ok()) {
                        assert!(query.contains("append_to_response=external_ids%2Cimages"), "{query}");
                        assert!(query.contains("include_image_language=en%2Cnull"), "{query}");
                        let imdb = if id % 5 == 0 { Value::Null } else { json!(format!("tt{id}")) };
                        let logos = if id % 2 == 0 {
                            json!([
                                { "iso_639_1": "es", "file_path": format!("/es{id}.png") },
                                { "iso_639_1": "en", "file_path": format!("/en{id}.png") },
                            ])
                        } else {
                            json!([])
                        };
                        match id {
                            305 => ("500 Internal Server Error", String::new()),
                            id => (
                                "200 OK",
                                json!({ "id": id, "external_ids": { "imdb_id": imdb }, "images": { "logos": logos } })
                                    .to_string(),
                            ),
                        }
                    } else {
                        ("404 Not Found", String::new())
                    };
                    let answer = format!(
                        "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nRetry-After: 0\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = sock.write_all(answer.as_bytes()).await;
                });
            }
        });
        (base, hits)
    }

    fn local(api: String) -> Tmdb {
        Tmdb { api, ..Tmdb::new("0123456789abcdef0123456789abcdef".into(), None) }
    }

    #[tokio::test]
    async fn pages_by_titles_kept_without_repeats() {
        let (api, _) = fake_tmdb().await;
        let tmdb = local(api);
        let ids = |list: Vec<MetaPreview>| list.into_iter().map(|m| m.id).collect::<Vec<_>>();

        let first = ids(tmdb.catalog("movie", "popular", 0, None).await.unwrap());
        assert_eq!(first.len(), PAGE_SIZE as usize);
        // Page 1 keeps 16 (no id for 100, 105, 110, 115); the rest come from page 2.
        assert_eq!(first[..3], ["tt101", "tt102", "tt103"]);
        assert_eq!(first[16..], ["tt202", "tt203", "tt204", "tt206"]);
        let page = tmdb.catalog("movie", "popular", 0, None).await.unwrap();
        // The row carries each title's English logo, as its page would, and none where TMDB has none.
        assert_eq!(page[1].logo.as_deref(), Some("https://image.tmdb.org/t/p/w500/en102.png"));
        assert_eq!(page[2].logo, None);
        // And all its logos, English first, for the app to choose from by contrast (#215).
        assert_eq!(
            page[1].logos,
            ["https://image.tmdb.org/t/p/w500/en102.png", "https://image.tmdb.org/t/p/w500/es102.png"]
        );
        assert!(page[2].logos.is_empty());

        let second = ids(tmdb.catalog("movie", "popular", 20, None).await.unwrap());
        assert_eq!(second[0], "tt207");
        assert!(second.iter().all(|id| !first.contains(id)), "skip=20 repeats a title");
        // Asking again gives the same slice, from the run already read.
        assert_eq!(ids(tmdb.catalog("movie", "popular", 0, None).await.unwrap()), first);
    }

    #[tokio::test]
    async fn a_failed_lookup_fails_the_page_and_keeps_the_run() {
        let (api, hits) = fake_tmdb().await;
        let tmdb = local(api);
        // Pages 1 and 2 keep 31 titles; page 3 holds 305, which never resolves.
        let err = tmdb.catalog("movie", "popular", 40, None).await.unwrap_err();
        assert!(
            matches!(err, IndexError::Upstream(ref m) if !m.contains("api_key") && !m.contains("0123456789abcdef")),
            "{err}"
        );
        // Titles already read past `skip` come back as a short page, never a thinned one.
        assert_eq!(tmdb.catalog("movie", "popular", 20, None).await.unwrap().len(), 11);
        let before = hits.load(Ordering::SeqCst);
        assert_eq!(tmdb.catalog("movie", "popular", 0, None).await.unwrap().len(), PAGE_SIZE as usize);
        assert_eq!(hits.load(Ordering::SeqCst), before, "a page already read was asked for again");
    }

    #[tokio::test]
    async fn a_tmdb_id_gives_its_imdb_id() {
        let (api, hits) = fake_tmdb().await;
        let tmdb = local(api);
        assert_eq!(tmdb.imdb_of("movie", 101).await.unwrap().as_deref(), Some("tt101"));
        // TMDB lists none for this one.
        assert_eq!(tmdb.imdb_of("movie", 100).await.unwrap(), None);
        let before = hits.load(Ordering::SeqCst);
        tmdb.imdb_of("movie", 101).await.unwrap();
        assert_eq!(hits.load(Ordering::SeqCst), before, "a title already looked up was asked for again");
    }

    #[tokio::test]
    async fn a_search_can_be_narrowed_to_a_year() {
        let (api, _) = fake_tmdb().await;
        let tmdb = local(api);
        let ids = |list: Vec<MetaPreview>| list.into_iter().map(|m| m.id).collect::<Vec<_>>();
        assert_eq!(ids(tmdb.search("movie", "t", Some(2001)).await.unwrap()), ["tt401"]);
        assert_eq!(ids(tmdb.search("movie", "t", None).await.unwrap()), ["tt401", "tt402", "tt403"]);
    }

    #[test]
    fn waits_as_asked_within_bounds() {
        let h = |v: &str| reqwest::header::HeaderValue::from_str(v).unwrap();
        assert_eq!(retry_wait(Some(&h("3")), 1), Duration::from_secs(3));
        assert_eq!(retry_wait(Some(&h("120")), 1), MAX_WAIT);
        assert_eq!(retry_wait(Some(&h("Wed, 21 Oct 2015 07:28:00 GMT")), 2), Duration::from_secs(2));
        assert_eq!(retry_wait(None, 1), Duration::from_secs(1));
        assert_eq!(retry_wait(None, 3), Duration::from_secs(4));
    }

    #[test]
    fn rotating_shelves_start_on_todays_page() {
        let (path, query, first) = list_request("series", "gems", Some("Drama")).unwrap();
        assert_eq!(path, "/discover/tv");
        assert_eq!(first as u64, 1 + curate::today() % 4);
        assert!(query.contains(&("with_genres".into(), "18".into())));
        // Search results name genres by id only; animation must come through as a name.
        assert_eq!(genre_name("series", 16), Some("Animation"));
        assert_eq!(genre_name("movie", 16), Some("Animation"));
        assert_eq!(genre_name("series", 10759), Some("Action"));
        assert_eq!(genre_name("movie", 878), Some("Sci-Fi"));
        assert_eq!(genre_name("movie", 1), None);
        assert!(matches!(list_request("movie", "popular", Some("Nope")), Err(IndexError::NotFound)));
        assert_eq!(list_request("movie", "trending", None).unwrap().0, "/trending/movie/week");
    }

    #[test]
    fn picks_official_trailer_then_trailer_then_teaser() {
        let v = |key: &str, ty: &str, official: bool| json!({ "site": "YouTube", "key": key, "type": ty, "official": official });
        let vids = [
            v("clip", "Clip", true),
            v("teaser", "Teaser", true),
            v("fan", "Trailer", false),
            v("real", "Trailer", true),
        ];
        assert_eq!(pick_trailer(&vids).as_deref(), Some("real"));
        assert_eq!(pick_trailer(&vids[..3]).as_deref(), Some("fan"));
        assert_eq!(pick_trailer(&vids[..2]).as_deref(), Some("teaser"));
        assert_eq!(pick_trailer(&vids[..1]), None);
        let vimeo = json!({ "site": "Vimeo", "key": "x", "type": "Trailer", "official": true });
        assert_eq!(pick_trailer(&[vimeo]), None);
    }

    #[test]
    fn a_search_result_names_its_genres() {
        let item: Item =
            serde_json::from_value(json!({"id": 1, "name": "Made Up Toon", "genre_ids": [16, 10759, 1]})).unwrap();
        let preview = item.into_preview("series", "tt0000001".into(), Vec::new());
        assert_eq!(preview.genres, ["Animation", "Action"]);
    }

    #[test]
    fn details_say_the_language_it_was_made_in() {
        let d = json!({"id": 1, "name": "Made Up Toon", "original_language": "ja"});
        assert_eq!(
            detail_to_meta("series", "tt0000001", &d, Vec::new()).details.original_language.as_deref(),
            Some("ja")
        );
        let d = json!({"id": 1, "name": "Made Up Toon", "original_language": ""});
        assert_eq!(detail_to_meta("series", "tt0000001", &d, Vec::new()).details.original_language, None);
    }
}
