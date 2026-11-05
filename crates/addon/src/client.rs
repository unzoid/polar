use std::time::Duration;

use serde::Deserialize;

use crate::types::*;

#[derive(Debug, thiserror::Error)]
pub enum AddonError {
    /// Without the URL: an addon's URL can carry the user's token (critique M1).
    #[error("network: {0}")]
    Http(reqwest::Error),
    #[error("addon returned an unexpected payload: {0}")]
    Decode(String),
}

impl From<reqwest::Error> for AddonError {
    fn from(e: reqwest::Error) -> Self {
        Self::Http(e.without_url())
    }
}

/// Largest addon JSON answer read. A long series' meta (a thousand episodes
/// with descriptions and stills) is a few MB; anything far past that is not
/// an answer worth holding in memory (critique M13).
pub const JSON_MAX: usize = 16 << 20;
/// Largest file `fetch_bytes` reads (subtitles run to a few hundred KB).
pub const FILE_MAX: usize = 10 << 20;

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
        manifest_url.trim_end_matches('/').trim_end_matches("/manifest.json")
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
        raw.meta.into_meta().ok_or_else(|| AddonError::Decode(format!("meta {id} has no name")))
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
        read_capped(self.http.get(url).send().await?.error_for_status()?, FILE_MAX).await
    }

    async fn get_json<T: serde::de::DeserializeOwned>(&self, url: &str) -> Result<T, AddonError> {
        let bytes = read_capped(self.http.get(url).send().await?.error_for_status()?, JSON_MAX).await?;
        serde_json::from_slice(&bytes).map_err(|e| AddonError::Decode(e.to_string()))
    }
}

/// The body, refused once it passes `max` bytes (whatever `Content-Length` says).
pub async fn read_capped(mut res: reqwest::Response, max: usize) -> Result<Vec<u8>, AddonError> {
    let too_big = || AddonError::Decode(format!("answer larger than {} MB", max >> 20));
    if res.content_length().is_some_and(|n| n > max as u64) {
        return Err(too_big());
    }
    let mut body = Vec::new();
    while let Some(chunk) = res.chunk().await? {
        if body.len() + chunk.len() > max {
            return Err(too_big());
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

pub fn resource_url(base: &str, resource: &str, ty: &str, id: &str, extra: &[(&str, &str)]) -> String {
    let base = AddonClient::base_url(base);
    let id = urlencoding::encode(id);
    if extra.is_empty() {
        format!("{base}/{resource}/{ty}/{id}.json")
    } else {
        let extra = extra.iter().map(|(k, v)| format!("{k}={}", urlencoding::encode(v))).collect::<Vec<_>>().join("&");
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
    pub writer: Option<Vec<Option<String>>>,
    /// A string ("United States, Canada") or a list, depending on the addon.
    pub country: Option<serde_json::Value>,
    pub awards: Option<String>,
    pub released: Option<String>,
    pub status: Option<String>,
    /// Cinemeta: `{ cast: [{ name, character, photo }] }`.
    pub app_extras: Option<serde_json::Value>,
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
        let mut videos: Vec<Video> = rest.videos.into_iter().filter_map(|v| v.normalise(&preview.id)).collect();
        videos.sort_by_key(|v| (v.season, v.episode));
        Some(Meta {
            preview,
            runtime: rest.runtime,
            cast: rest.cast,
            director: rest.director,
            trailer_yt_id: rest.trailer,
            trailer_source: None,
            videos,
            people: rest.people,
            details: rest.details,
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
        let people = self
            .app_extras
            .as_ref()
            .and_then(|x| x["cast"].as_array())
            .map(|cast| {
                cast.iter()
                    .filter_map(|p| {
                        let text = |k: &str| p[k].as_str().map(str::trim).filter(|s| !s.is_empty()).map(str::to_owned);
                        Some(Person { name: text("name")?, character: text("character"), photo: text("photo") })
                    })
                    .take(24)
                    .collect()
            })
            .unwrap_or_default();
        let countries = match self.country {
            Some(serde_json::Value::String(s)) => {
                s.split(',').map(|c| c.trim().to_owned()).filter(|c| !c.is_empty()).collect()
            }
            Some(serde_json::Value::Array(a)) => a.into_iter().filter_map(|c| c.as_str().map(str::to_owned)).collect(),
            _ => Vec::new(),
        };
        let details = MetaDetails {
            status: self.status.filter(|s| !s.is_empty()),
            released: self.released.and_then(|d| d.get(..10).map(str::to_owned)),
            countries,
            writers: strings(self.writer),
            // Cinemeta says "N/A" for none.
            awards: self.awards.filter(|a| !a.is_empty() && a != "N/A"),
            ..Default::default()
        };
        let rest = Rest {
            runtime: self.runtime,
            cast: strings(self.cast),
            director: strings(self.director),
            trailer: self.trailers.and_then(|t| t.into_iter().find_map(|t| t.source)),
            videos: self.videos.unwrap_or_default(),
            people,
            details,
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
    people: Vec<Person>,
    details: MetaDetails,
}

impl RawVideo {
    fn normalise(self, meta_id: &str) -> Option<Video> {
        let season = self.season?;
        let episode = self.episode.or(self.number)?;
        Some(Video {
            id: self.id.unwrap_or_else(|| format!("{meta_id}:{season}:{episode}")),
            title: self.name.or(self.title).filter(|t| !t.is_empty()).unwrap_or_else(|| format!("Episode {episode}")),
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

    /// Answers one request on 127.0.0.1 with `body`, chunked so no length is announced.
    fn serve_once(body: Vec<u8>) -> String {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        std::thread::spawn(move || {
            use std::io::{Read, Write};
            let (mut sock, _) = listener.accept().unwrap();
            let _ = sock.read(&mut [0u8; 4096]);
            let _ = sock.write_all(b"HTTP/1.1 200 OK\r\nConnection: close\r\nTransfer-Encoding: chunked\r\n\r\n");
            for part in body.chunks(64 << 10) {
                let _ = sock.write_all(format!("{:x}\r\n", part.len()).as_bytes());
                let _ = sock.write_all(part);
                let _ = sock.write_all(b"\r\n");
            }
            let _ = sock.write_all(b"0\r\n\r\n");
        });
        base
    }

    fn block<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(f)
    }

    #[test]
    fn bodies_past_the_cap_are_refused_and_smaller_ones_read() {
        let client = AddonClient::new();
        let big = serve_once(vec![b'a'; FILE_MAX + 1]);
        let err = block(client.fetch_bytes(&format!("{big}/sub.srt"))).unwrap_err();
        assert!(err.to_string().contains("larger than 10 MB"), "{err}");
        let small = serve_once(b"1\n00:00:01,000 --> 00:00:02,000\nhi\n".to_vec());
        assert_eq!(block(client.fetch_bytes(&format!("{small}/sub.srt"))).unwrap().len(), 35);
    }

    #[test]
    fn network_errors_leave_the_url_out() {
        let client = AddonClient::new();
        // Nothing listens on port 9 here; the token in the path must not reach the message.
        let err = block(client.fetch_bytes("http://127.0.0.1:9/secret-token/sub.srt")).unwrap_err();
        assert!(!err.to_string().contains("secret-token"), "{err}");
    }

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
