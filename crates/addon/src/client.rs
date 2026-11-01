use std::time::Duration;

use serde::Deserialize;

use crate::types::*;

#[derive(Debug, thiserror::Error)]
pub enum AddonError {
    #[error("network: {0}")]
    Http(#[from] reqwest::Error),
    #[error("addon returned an unexpected payload: {0}")]
    Decode(String),
}

/// Talks to any Stremio-protocol addon over HTTP.
#[derive(Clone)]
pub struct AddonClient {
    http: reqwest::Client,
}

impl Default for AddonClient {
    fn default() -> Self {
        Self::new()
    }
}

impl AddonClient {
    pub fn new() -> Self {
        Self::with_client(
            reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(20))
                .user_agent(concat!("polar/", env!("CARGO_PKG_VERSION")))
                .build()
                .expect("http client"),
        )
    }

    pub fn with_client(http: reqwest::Client) -> Self {
        Self { http }
    }

    /// `https://x/manifest.json` → `https://x`
    pub fn base_url(manifest_url: &str) -> &str {
        manifest_url
            .trim_end_matches('/')
            .trim_end_matches("/manifest.json")
    }

    pub async fn manifest(&self, manifest_url: &str) -> Result<Manifest, AddonError> {
        self.get_json(manifest_url).await
    }

    pub async fn catalog(
        &self,
        base: &str,
        ty: &str,
        id: &str,
        extra: &[(&str, &str)],
    ) -> Result<Vec<MetaPreview>, AddonError> {
        let url = resource_url(base, "catalog", ty, id, extra);
        let raw: RawCatalog = self.get_json(&url).await?;
        Ok(raw.metas.into_iter().filter_map(RawMeta::into_preview).collect())
    }

    pub async fn meta(&self, base: &str, ty: &str, id: &str) -> Result<Meta, AddonError> {
        let url = resource_url(base, "meta", ty, id, &[]);
        let raw: RawMetaResponse = self.get_json(&url).await?;
        raw.meta
            .into_meta()
            .ok_or_else(|| AddonError::Decode(format!("meta {id} has no name")))
    }

    pub async fn streams(&self, base: &str, ty: &str, id: &str) -> Result<Vec<Stream>, AddonError> {
        let url = resource_url(base, "stream", ty, id, &[]);
        let raw: StreamsResponse = self.get_json(&url).await?;
        Ok(raw.streams)
    }

    pub async fn subtitles(&self, base: &str, ty: &str, id: &str) -> Result<Vec<Subtitle>, AddonError> {
        let url = resource_url(base, "subtitles", ty, id, &[]);
        let raw: SubtitlesResponse = self.get_json(&url).await?;
        Ok(raw.subtitles)
    }

    /// Raw bytes of a file (subtitles), with the client's timeouts.
    pub async fn fetch_bytes(&self, url: &str) -> Result<Vec<u8>, AddonError> {
        Ok(self.http.get(url).send().await?.error_for_status()?.bytes().await?.to_vec())
    }

    async fn get_json<T: serde::de::DeserializeOwned>(&self, url: &str) -> Result<T, AddonError> {
        let bytes = self.http.get(url).send().await?.error_for_status()?.bytes().await?;
        serde_json::from_slice(&bytes).map_err(|e| AddonError::Decode(e.to_string()))
    }
}

pub fn resource_url(base: &str, resource: &str, ty: &str, id: &str, extra: &[(&str, &str)]) -> String {
    let base = AddonClient::base_url(base);
    let id = urlencoding::encode(id);
    if extra.is_empty() {
        format!("{base}/{resource}/{ty}/{id}.json")
    } else {
        let extra = extra
            .iter()
            .map(|(k, v)| format!("{k}={}", urlencoding::encode(v)))
            .collect::<Vec<_>>()
            .join("&");
        format!("{base}/{resource}/{ty}/{id}/{extra}.json")
    }
}

// --- Lenient wire shapes -------------------------------------------------
//
// Real addons disagree on field names (`name` vs `title`, `number` vs `episode`,
// `firstAired` vs `released`) and often send *both*, which serde aliases reject.
// Parse everything as optional, then normalise once.

#[derive(Deserialize)]
struct RawCatalog {
    #[serde(default)]
    metas: Vec<RawMeta>,
}

#[derive(Deserialize)]
struct RawMetaResponse {
    meta: RawMeta,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RawMeta {
    pub id: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub name: Option<String>,
    pub poster: Option<String>,
    pub background: Option<String>,
    pub logo: Option<String>,
    pub description: Option<String>,
    pub release_info: Option<serde_json::Value>,
    pub year: Option<serde_json::Value>,
    pub imdb_rating: Option<serde_json::Value>,
    pub genres: Option<Vec<Option<String>>>,
    pub genre: Option<Vec<Option<String>>>,
    pub runtime: Option<String>,
    pub cast: Option<Vec<Option<String>>>,
    pub director: Option<Vec<Option<String>>>,
    pub trailers: Option<Vec<RawTrailer>>,
    pub videos: Option<Vec<RawVideo>>,
}

#[derive(Deserialize, Default)]
#[serde(default)]
pub struct RawTrailer {
    pub source: Option<String>,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct RawVideo {
    pub id: Option<String>,
    pub name: Option<String>,
    pub title: Option<String>,
    pub season: Option<u32>,
    pub episode: Option<u32>,
    pub number: Option<u32>,
    pub released: Option<String>,
    pub first_aired: Option<String>,
    pub thumbnail: Option<String>,
    pub overview: Option<String>,
    pub description: Option<String>,
    pub rating: Option<serde_json::Value>,
}

fn value_to_string(v: Option<serde_json::Value>) -> Option<String> {
    match v? {
        serde_json::Value::String(s) if !s.is_empty() => Some(s),
        serde_json::Value::Number(n) => Some(n.to_string()),
        _ => None,
    }
}

/// Some addons send `null` inside string arrays; tolerate it.
fn strings(v: Option<Vec<Option<String>>>) -> Vec<String> {
    v.unwrap_or_default().into_iter().flatten().collect()
}

impl RawMeta {
    pub fn into_preview(self) -> Option<MetaPreview> {
        Some(self.split()?.0)
    }

    pub fn into_meta(self) -> Option<Meta> {
        let (preview, rest) = self.split()?;
        let mut videos: Vec<Video> = rest
            .videos
            .into_iter()
            .filter_map(|v| v.normalise(&preview.id))
            .collect();
        videos.sort_by_key(|v| (v.season, v.episode));
        Some(Meta {
            preview,
            runtime: rest.runtime,
            cast: rest.cast,
            director: rest.director,
            trailer_yt_id: rest.trailer,
            videos,
        })
    }

    fn split(self) -> Option<(MetaPreview, Rest)> {
        let name = self.name.filter(|n| !n.is_empty())?;
        let preview = MetaPreview {
            id: self.id,
            ty: self.ty,
            name,
            poster: self.poster,
            background: self.background,
            logo: self.logo,
            description: self.description,
            release_info: value_to_string(self.release_info).or_else(|| value_to_string(self.year)),
            imdb_rating: value_to_string(self.imdb_rating),
            genres: strings(self.genres.or(self.genre)),
        };
        let rest = Rest {
            runtime: self.runtime,
            cast: strings(self.cast),
            director: strings(self.director),
            trailer: self.trailers.and_then(|t| t.into_iter().find_map(|t| t.source)),
            videos: self.videos.unwrap_or_default(),
        };
        Some((preview, rest))
    }
}

struct Rest {
    runtime: Option<String>,
    cast: Vec<String>,
    director: Vec<String>,
    trailer: Option<String>,
    videos: Vec<RawVideo>,
}

impl RawVideo {
    fn normalise(self, meta_id: &str) -> Option<Video> {
        let season = self.season?;
        let episode = self.episode.or(self.number)?;
        Some(Video {
            id: self.id.unwrap_or_else(|| format!("{meta_id}:{season}:{episode}")),
            title: self
                .name
                .or(self.title)
                .filter(|t| !t.is_empty())
                .unwrap_or_else(|| format!("Episode {episode}")),
            season,
            episode,
            released: self.released.or(self.first_aired),
            thumbnail: self.thumbnail,
            overview: self.overview.or(self.description).filter(|o| !o.is_empty()),
            // Cinemeta sends "0" for unrated episodes; that's absence, not a score.
            rating: value_to_string(self.rating).filter(|r| r.parse::<f64>().map_or(true, |n| n > 0.0)),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_urls() {
        assert_eq!(
            resource_url("https://a.io/manifest.json", "stream", "series", "tt1:1:2", &[]),
            "https://a.io/stream/series/tt1%3A1%3A2.json"
        );
        assert_eq!(
            resource_url("https://a.io", "catalog", "movie", "top", &[("search", "sandglass 2")]),
            "https://a.io/catalog/movie/top/search=sandglass%202.json"
        );
    }

    #[test]
    fn tolerates_duplicate_field_names() {
        let json = r#"{"meta":{"id":"tt1","type":"series","name":"X","videos":[
            {"name":"Pilot","title":"Pilot","season":1,"number":1,"episode":1,
             "firstAired":"2008","released":"2008","overview":"o","description":"o"}]}}"#;
        let raw: RawMetaResponse = serde_json::from_str(json).unwrap();
        let meta = raw.meta.into_meta().unwrap();
        assert_eq!(meta.videos[0].id, "tt1:1:1");
        assert_eq!(meta.videos[0].title, "Pilot");
    }
}
