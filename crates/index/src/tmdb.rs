//! Primary source: TMDB, normalised to IMDb-keyed addon types.
//!
//! TMDB list endpoints don't include IMDb ids, so each result is resolved via
//! `external_ids` concurrently. Mappings never change and are cached for a day,
//! so only the first view of a catalog pays for it.

use std::time::Duration;

use futures::future::join_all;
use polar_addon::{Meta, MetaDetails, MetaPreview, Person, Video};
use serde::Deserialize;
use serde_json::Value;

use crate::cache::TtlCache;
use crate::{curate, IndexError, Result};

const API: &str = "https://api.themoviedb.org/3";
const IMG: &str = "https://image.tmdb.org/t/p";

pub struct Tmdb {
    http: reqwest::Client,
    key: String,
    language: String,
    imdb_ids: TtlCache<(char, u64), Option<String>>,
}

impl Tmdb {
    pub fn new(key: String, language: Option<String>) -> Self {
        Self {
            http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(15))
                .build()
                .expect("http client"),
            key: key.trim().to_owned(),
            language: language.unwrap_or_else(|| "en-US".into()),
            imdb_ids: TtlCache::new(Duration::from_secs(24 * 60 * 60), 20_000),
        }
    }

    async fn get<T: serde::de::DeserializeOwned>(&self, path: &str, query: &[(&str, &str)]) -> Result<T> {
        let mut req = self.http.get(format!("{API}{path}")).query(&[("language", self.language.as_str())]).query(query);
        // v4 read tokens are JWTs; v3 keys are 32 hex chars.
        req = if self.key.starts_with("eyJ") {
            req.bearer_auth(&self.key)
        } else {
            req.query(&[("api_key", self.key.as_str())])
        };
        let res = req.send().await?;
        if res.status() == reqwest::StatusCode::NOT_FOUND {
            return Err(IndexError::NotFound);
        }
        Ok(res.error_for_status()?.json().await?)
    }

    pub async fn catalog(&self, ty: &str, id: &str, page: u32, genre: Option<&str>) -> Result<Vec<MetaPreview>> {
        let kind = tmdb_kind(ty);
        if matches!(id, "new" | "gems" | "classics") {
            return self.discover(ty, id, page, genre).await;
        }
        if let Some(name) = genre {
            let genre_id = genre_id(ty, name).ok_or(IndexError::NotFound)?.to_string();
            let page = page.to_string();
            let (sort, min_votes) =
                if id == "top_rated" { ("vote_average.desc", "300") } else { ("popularity.desc", "0") };
            let list: Paged = self
                .get(
                    &format!("/discover/{kind}"),
                    &[("with_genres", &genre_id), ("sort_by", sort), ("vote_count.gte", min_votes), ("page", &page)],
                )
                .await?;
            return self.previews(ty, list.results).await;
        }
        let path = match id {
            "trending" => format!("/trending/{kind}/week"),
            "top_rated" => format!("/{kind}/top_rated"),
            "popular" => format!("/{kind}/popular"),
            _ => return Err(IndexError::NotFound),
        };
        let page = page.to_string();
        let list: Paged = self.get(&path, &[("page", &page)]).await?;
        self.previews(ty, list.results).await
    }

    /// The curated shelves, as `/discover` queries. Gems and classics start on
    /// a page that rotates daily, so they don't open on the same titles.
    async fn discover(&self, ty: &str, id: &str, page: u32, genre: Option<&str>) -> Result<Vec<MetaPreview>> {
        let day = curate::today();
        let date_field = if ty == "series" { "first_air_date" } else { "primary_release_date" };
        let mut query: Vec<(String, String)> = match id {
            "new" => vec![
                (format!("{date_field}.gte"), curate::date(day.saturating_sub(240))),
                (format!("{date_field}.lte"), curate::date(day)),
                ("sort_by".into(), "popularity.desc".into()),
                ("vote_count.gte".into(), "25".into()),
            ],
            "gems" => vec![
                ("sort_by".into(), "vote_average.desc".into()),
                ("vote_average.gte".into(), "7.3".into()),
                ("vote_count.gte".into(), "150".into()),
                ("vote_count.lte".into(), "2500".into()),
            ],
            _ => vec![
                (format!("{date_field}.lte"), "2009-12-31".into()),
                ("sort_by".into(), "vote_average.desc".into()),
                ("vote_count.gte".into(), if ty == "series" { "400" } else { "1500" }.into()),
            ],
        };
        let offset = match id {
            "gems" => day % 4,
            "classics" => day % 6,
            _ => 0,
        } as u32;
        query.push(("page".into(), (page + offset).to_string()));
        if let Some(name) = genre {
            query.push(("with_genres".into(), genre_id(ty, name).ok_or(IndexError::NotFound)?.to_string()));
        }
        let query: Vec<(&str, &str)> = query.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        let list: Paged = self.get(&format!("/discover/{}", tmdb_kind(ty)), &query).await?;
        self.previews(ty, list.results).await
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

    pub async fn search(&self, ty: &str, query: &str) -> Result<Vec<MetaPreview>> {
        let path = format!("/search/{}", tmdb_kind(ty));
        let list: Paged = self.get(&path, &[("query", query)]).await?;
        self.previews(ty, list.results).await
    }

    async fn previews(&self, ty: &str, items: Vec<Item>) -> Result<Vec<MetaPreview>> {
        let resolved = join_all(items.iter().map(|item| self.imdb_id(ty, item.id))).await;
        Ok(items
            .into_iter()
            .zip(resolved)
            .filter_map(|(item, imdb)| Some(item.into_preview(ty, imdb.ok().flatten()?)))
            .collect())
    }

    async fn imdb_id(&self, ty: &str, tmdb_id: u64) -> Result<Option<String>> {
        let key = (ty.chars().next().unwrap_or('m'), tmdb_id);
        if let Some(hit) = self.imdb_ids.get(&key) {
            return Ok(hit);
        }
        let ids: ExternalIds = self.get(&format!("/{}/{tmdb_id}/external_ids", tmdb_kind(ty)), &[]).await?;
        let imdb = ids.imdb_id.filter(|i| i.starts_with("tt"));
        self.imdb_ids.insert(key, imdb.clone());
        Ok(imdb)
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
        for result in join_all(requests).await {
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

    let logo = d["images"]["logos"].as_array().and_then(|logos| {
        logos
            .iter()
            .find(|l| l["iso_639_1"] == "en")
            .or(logos.first())
            .and_then(|l| str_of(&l["file_path"]))
            .map(|p| format!("{IMG}/w500{p}"))
    });

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

    let trailer_yt_id = d["videos"]["results"].as_array().and_then(|v| {
        v.iter().find(|v| v["site"] == "YouTube" && v["type"] == "Trailer").and_then(|v| str_of(&v["key"]))
    });

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
            logo,
            description: str_of(&d["overview"]),
            release_info,
            imdb_rating: d["vote_average"].as_f64().filter(|r| *r > 0.0).map(|r| format!("{r:.1}")),
            genres: names(&d["genres"], 4),
        },
        runtime,
        cast: names(&d["credits"]["cast"], 10),
        director,
        trailer_yt_id,
        videos,
    }
}

#[derive(Deserialize)]
struct Paged {
    #[serde(default)]
    results: Vec<Item>,
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
}

impl Item {
    fn into_preview(self, ty: &str, imdb_id: String) -> MetaPreview {
        MetaPreview {
            id: imdb_id,
            ty: ty.into(),
            name: self.title.or(self.name).unwrap_or_default(),
            poster: self.poster_path.map(|p| format!("{IMG}/w342{p}")),
            background: self.backdrop_path.map(|p| format!("{IMG}/w1280{p}")),
            logo: None,
            description: self.overview.filter(|o| !o.is_empty()),
            release_info: self.release_date.or(self.first_air_date).and_then(|d| d.get(..4).map(str::to_owned)),
            imdb_rating: self.vote_average.filter(|r| *r > 0.0).map(|r| format!("{r:.1}")),
            genres: Vec::new(),
        }
    }
}

#[derive(Deserialize)]
struct ExternalIds {
    imdb_id: Option<String>,
}
