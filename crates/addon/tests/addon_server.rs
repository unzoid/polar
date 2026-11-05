//! The add-on client against a local add-on server: each resource the app asks for, redirects,
//! HTTP errors, broken JSON and size caps, as a real add-on would answer them over HTTP.

use polar_addon::client::JSON_MAX;
use polar_addon::{AddonClient, AddonError};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

/// Runs a test's future (the crate's tokio has no macros; see probe.rs).
fn block<F: std::future::Future>(f: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(f)
}

const MANIFEST: &str = r#"{"id":"org.example.films","version":"1.0.0","name":"Open Films",
  "resources":["catalog","meta",{"name":"stream","types":["movie","series"],"idPrefixes":["tt"]},"subtitles"],
  "types":["movie","series"],"idPrefixes":["tt"],
  "catalogs":[{"type":"movie","id":"top","name":"Top","extra":[{"name":"search"},{"name":"skip"}]}]}"#;

/// What the server answers for a path: status, extra headers, body.
fn route(path: &str) -> (u16, Vec<(&'static str, String)>, Vec<u8>) {
    let json = |s: &str| (200, vec![("Content-Type", "application/json".into())], s.as_bytes().to_vec());
    match path {
        "/manifest.json" => json(MANIFEST),
        "/old/manifest.json" => (301, vec![("Location", "/manifest.json".into())], vec![]),
        "/loop/manifest.json" => (302, vec![("Location", "/loop/manifest.json".into())], vec![]),
        "/catalog/movie/top.json" => json(
            r#"{"metas":[{"id":"tt0001","type":"movie","name":"Sintel","poster":"https://img/p.jpg","imdbRating":"7.4"},
              {"id":"tt0002","type":"movie"},{"id":"tt0003","type":"movie","name":"Big Buck Bunny","genres":["Animation"]}]}"#,
        ),
        "/catalog/movie/top/search=tears%20of%20steel.json" => {
            json(r#"{"metas":[{"id":"tt0004","type":"movie","name":"Tears of Steel"}]}"#)
        }
        "/meta/series/tt0005.json" => json(
            r#"{"meta":{"id":"tt0005","type":"series","name":"Open Series","runtime":"24 min","videos":[
              {"id":"tt0005:1:2","title":"Two","season":1,"episode":2,"released":"2020-01-08T00:00:00.000Z"},
              {"id":"tt0005:1:1","name":"One","season":1,"number":1,"released":"2020-01-01T00:00:00.000Z","rating":"0"}]}}"#,
        ),
        "/meta/series/tt0006.json" => json(r#"{"meta":{"id":"tt0006","type":"series"}}"#),
        "/stream/series/tt0005%3A1%3A1.json" => json(
            r#"{"streams":[{"url":"https://cdn.example/one.mp4","name":"Open","title":"1080p"},
              {"externalUrl":"https://example.org/watch"},{"ytId":"abc"}]}"#,
        ),
        "/subtitles/movie/tt0001.json" => json(r#"{"subtitles":[{"id":"1","url":"https://subs/1.srt","lang":"eng"}]}"#),
        "/meta/movie/broken.json" => json(r#"{"meta":"#),
        "/meta/movie/html.json" => (200, vec![("Content-Type", "text/html".into())], b"<html>busy</html>".to_vec()),
        "/catalog/movie/huge.json" => (200, vec![("Content-Length", (JSON_MAX + 1).to_string())], vec![]),
        _ if path.contains("token-") => (500, vec![], b"server error".to_vec()),
        _ => (404, vec![], b"not found".to_vec()),
    }
}

/// Serves `route` on 127.0.0.1 until the test ends; returns the base URL.
async fn serve() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        loop {
            let Ok((mut sock, _)) = listener.accept().await else { return };
            tokio::spawn(async move {
                let mut buf = vec![0u8; 8192];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]);
                let path = request.split_whitespace().nth(1).unwrap_or("/").to_string();
                let (status, headers, body) = route(&path);
                let mut head = format!("HTTP/1.1 {status} X\r\nConnection: close\r\n");
                if !headers.iter().any(|(k, _)| *k == "Content-Length") {
                    head += &format!("Content-Length: {}\r\n", body.len());
                }
                for (k, v) in headers {
                    head += &format!("{k}: {v}\r\n");
                }
                head += "\r\n";
                let _ = sock.write_all(head.as_bytes()).await;
                let _ = sock.write_all(&body).await;
                let _ = sock.shutdown().await;
            });
        }
    });
    base
}

#[test]
fn reads_the_manifest_and_follows_a_moved_one() {
    block(async {
        let base = serve().await;
        let client = AddonClient::new();
        let manifest = client.manifest(&format!("{base}/manifest.json")).await.unwrap();
        assert_eq!(manifest.name, "Open Films");
        assert_eq!(manifest.catalogs.len(), 1);
        assert_eq!(manifest.catalogs[0].extra.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), ["search", "skip"]);
        assert_eq!(manifest.resources.len(), 4);
        let moved = client.manifest(&format!("{base}/old/manifest.json")).await.unwrap();
        assert_eq!(moved.id, "org.example.films");
    });
}

#[test]
fn catalogs_drop_nameless_items_and_pass_search_as_extra() {
    block(async {
        let base = serve().await;
        let client = AddonClient::new();
        let top = client.catalog(&base, "movie", "top", &[]).await.unwrap();
        assert_eq!(top.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["tt0001", "tt0003"]);
        assert_eq!(top[0].imdb_rating.as_deref(), Some("7.4"));
        assert_eq!(top[1].genres, ["Animation"]);
        let found = client
            .catalog(&format!("{base}/manifest.json"), "movie", "top", &[("search", "tears of steel")])
            .await
            .unwrap();
        assert_eq!(found[0].name, "Tears of Steel");
    });
}

#[test]
fn meta_normalises_episodes_and_refuses_a_nameless_title() {
    block(async {
        let base = serve().await;
        let client = AddonClient::new();
        let meta = client.meta(&base, "series", "tt0005").await.unwrap();
        assert_eq!(meta.preview.name, "Open Series");
        let episodes: Vec<_> =
            meta.videos.iter().map(|v| (v.id.as_str(), v.title.as_str(), v.season, v.episode)).collect();
        assert!(episodes.contains(&("tt0005:1:1", "One", 1, 1)), "{episodes:?}");
        assert!(episodes.contains(&("tt0005:1:2", "Two", 1, 2)), "{episodes:?}");
        // Cinemeta's "0" rating means unrated.
        assert!(meta.videos.iter().all(|v| v.rating.is_none()));
        let err = client.meta(&base, "series", "tt0006").await.unwrap_err();
        assert!(matches!(err, AddonError::Decode(_)), "{err}");
    });
}

#[test]
fn streams_and_subtitles_come_back_as_sent() {
    block(async {
        let base = serve().await;
        let client = AddonClient::new();
        let streams = client.streams(&base, "series", "tt0005:1:1").await.unwrap();
        assert_eq!(streams.len(), 3);
        assert_eq!(streams[0].url.as_deref(), Some("https://cdn.example/one.mp4"));
        assert_eq!(streams[1].external_url.as_deref(), Some("https://example.org/watch"));
        assert_eq!(streams[2].yt_id.as_deref(), Some("abc"));
        let subs = client.subtitles(&base, "movie", "tt0001").await.unwrap();
        assert_eq!(subs.len(), 1);
    });
}

#[test]
fn errors_say_what_went_wrong_without_the_link() {
    block(async {
        let base = serve().await;
        let client = AddonClient::new();
        // An HTTP error status: the token in the add-on's URL stays out of the message.
        let err = client.streams(&format!("{base}/token-s3cret"), "movie", "tt0001").await.unwrap_err();
        let text = err.to_string();
        assert!(matches!(err, AddonError::Http(_)) && text.contains("500") && !text.contains("s3cret"), "{text}");
        // A redirect loop gives up, again without the link.
        let err = client.manifest(&format!("{base}/loop/manifest.json")).await.unwrap_err();
        assert!(!err.to_string().contains("/loop/"), "{err}");
        // Missing resources, broken JSON, a web page instead of JSON.
        assert!(client.meta(&base, "movie", "missing").await.unwrap_err().to_string().contains("404"));
        assert!(matches!(client.meta(&base, "movie", "broken").await, Err(AddonError::Decode(_))));
        assert!(matches!(client.meta(&base, "movie", "html").await, Err(AddonError::Decode(_))));
    });
}

#[test]
fn an_announced_body_past_the_cap_is_refused_before_reading() {
    block(async {
        let base = serve().await;
        let err = AddonClient::new().catalog(&base, "movie", "huge", &[]).await.unwrap_err();
        assert!(err.to_string().contains("larger than 16 MB"), "{err}");
    });
}
