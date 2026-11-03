//! Trailers as plain video files, from IMDb's GraphQL API (the one imdb.com
//! itself uses): signed MP4s up to 1080p on IMDb's CDN, which the webview
//! plays in its own <video> — no YouTube embed, no yt-dlp. The links expire
//! after a day, so callers shouldn't keep them longer than a few hours.
//! "No trailer" is `None`, never an error: the app falls back to YouTube.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;

const API: &str = "https://api.graphql.imdb.com/";
const QUERY: &str = "query ($id: ID!) { title(id: $id) { primaryVideos(first: 10) { edges { node {
  name { value } contentType { id } runtime { value }
  playbackURLs { displayName { value } videoMimeType url } } } } } }";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Trailer {
    pub name: String,
    pub url: String,
    /// "1080p", "720p"…
    pub quality: String,
}

#[derive(Deserialize)]
struct Resp {
    data: Option<Data>,
}
#[derive(Deserialize)]
struct Data {
    title: Option<Title>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Title {
    primary_videos: Edges,
}
#[derive(Deserialize)]
struct Edges {
    edges: Vec<Edge>,
}
#[derive(Deserialize)]
struct Edge {
    node: Video,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Video {
    name: Option<Text>,
    content_type: Option<Id>,
    runtime: Option<Num>,
    #[serde(default, rename = "playbackURLs")]
    playback_urls: Vec<Playback>,
}
#[derive(Deserialize)]
struct Text {
    value: String,
}
#[derive(Deserialize)]
struct Id {
    id: String,
}
#[derive(Deserialize)]
struct Num {
    value: u32,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Playback {
    display_name: Option<Text>,
    video_mime_type: Option<String>,
    url: String,
}

/// Higher is better; only MP4 (the webview can't play HLS by itself).
fn quality_rank(label: &str) -> u32 {
    match label {
        "1080p" => 4,
        "720p" => 3,
        "480p" => 2,
        "SD" => 1,
        _ => 0,
    }
}

pub async fn imdb_trailer(imdb_id: &str) -> Option<Trailer> {
    let valid = imdb_id.len() > 2 && imdb_id.starts_with("tt") && imdb_id[2..].bytes().all(|b| b.is_ascii_digit());
    if !valid {
        return None;
    }
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .build()
        .ok()?;
    let resp: Resp = http
        .post(API)
        // Without it the API answers 403.
        .header("x-imdb-client-name", "imdb-web-next-localized")
        .json(&json!({ "query": QUERY, "variables": { "id": imdb_id } }))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    pick(resp.data?.title?.primary_videos.edges.into_iter().map(|e| e.node).collect())
}

/// A real trailer over a clip or a teaser: trailers first, then the best
/// picture, then one that runs a minute or more.
fn pick(videos: Vec<Video>) -> Option<Trailer> {
    videos
        .into_iter()
        .filter_map(|v| {
            let trailer = v.content_type.as_ref().is_some_and(|c| c.id.ends_with(".trailer"));
            let long = v.runtime.as_ref().is_some_and(|r| r.value >= 60);
            let (rank, p) = v
                .playback_urls
                .into_iter()
                .filter(|p| p.video_mime_type.as_deref() == Some("MP4"))
                .map(|p| (quality_rank(p.display_name.as_ref().map_or("", |d| d.value.as_str())), p))
                .max_by_key(|(r, _)| *r)?;
            let quality = p.display_name.map(|d| d.value).unwrap_or_default();
            let name = v.name.map(|n| n.value).unwrap_or_default();
            Some(((trailer, rank, long), Trailer { name, url: p.url, quality }))
        })
        .max_by_key(|(key, _)| *key)
        .map(|(_, t)| t)
}

#[cfg(test)]
mod tests {
    /// Hits the network: `cargo test -p polar trailers -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn finds_a_public_domain_films_trailer() {
        let t = super::imdb_trailer("tt0063350").await.expect("a trailer");
        assert!(t.url.contains(".mp4"), "{t:?}");
        println!("{} · {}", t.name, t.quality);
    }
}
