//! Fribb/anime-lists (https://github.com/Fribb/anime-lists): one JSON file
//! mapping each anime's AniList, MyAnimeList, Kitsu and AniDB ids to its
//! IMDb, TMDB and TVDB ids. It is the fallback for when ani.zip, which the
//! app asks first, can't be reached: with it a show can still be told apart
//! as anime and found on IMDb or Kitsu.
//!
//! The file (`anime-list-mini.json`, about 6 MB) is downloaded only the first
//! time the fallback is needed, kept in the app's cache folder and replaced
//! when it is over a week old. It is fetched at runtime, not bundled
//! (docs/data-sources.md, Decisions).

use std::collections::HashMap;
use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

/// How long the file is used before downloading it again.
pub const TTL: Duration = Duration::from_secs(7 * 24 * 60 * 60);
/// After a failed download, how long to keep the old file before trying again.
const RETRY: Duration = Duration::from_secs(60 * 60);
const FILE: &str = "anime-list-mini.json";
const URL: &str = "https://raw.githubusercontent.com/Fribb/anime-lists/master/anime-list-mini.json";

/// What to look a show up by.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AnimeKey {
    Anilist(u32),
    Mal(u32),
    Kitsu(u32),
    /// `tt…`. Several entries (a show's seasons) can share one; the TV
    /// entry for its first season is chosen.
    Imdb(String),
}

/// One anime's ids, named as ani.zip names them in its `mappings`, so the
/// app can use either answer the same way.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct AnimeMapping {
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub ty: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anilist_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mal_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kitsu_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub anidb_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub imdb_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub themoviedb_id: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub thetvdb_id: Option<u32>,
    /// The TVDB/TMDB season this entry is, and how many episodes into it
    /// it starts; ani.zip gives per-episode numbers instead.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub season: Option<SeasonNumbers>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub episode_offset: Option<SeasonNumbers>,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Serialize, Deserialize)]
pub struct SeasonNumbers {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tvdb: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tmdb: Option<u32>,
}

/// An entry as the file has it.
#[derive(Deserialize)]
struct Raw {
    #[serde(rename = "type")]
    ty: Option<String>,
    anilist_id: Option<u32>,
    mal_id: Option<u32>,
    kitsu_id: Option<u32>,
    anidb_id: Option<u32>,
    imdb_id: Option<Vec<String>>,
    themoviedb_id: Option<RawTmdb>,
    tvdb_id: Option<u32>,
    season: Option<SeasonNumbers>,
    episode_offset: Option<SeasonNumbers>,
}

#[derive(Deserialize)]
struct RawTmdb {
    tv: Option<u32>,
    movie: Option<u32>,
}

impl From<Raw> for AnimeMapping {
    fn from(r: Raw) -> Self {
        Self {
            ty: r.ty,
            anilist_id: r.anilist_id,
            mal_id: r.mal_id,
            kitsu_id: r.kitsu_id,
            anidb_id: r.anidb_id,
            imdb_id: r.imdb_id.and_then(|v| v.into_iter().find(|id| id.starts_with("tt"))),
            themoviedb_id: r.themoviedb_id.and_then(|t| t.tv.or(t.movie)),
            thetvdb_id: r.tvdb_id,
            season: r.season,
            episode_offset: r.episode_offset,
        }
    }
}

/// The file, parsed and indexed.
#[derive(Default)]
struct Index {
    entries: Vec<AnimeMapping>,
    anilist: HashMap<u32, usize>,
    mal: HashMap<u32, usize>,
    kitsu: HashMap<u32, usize>,
    imdb: HashMap<String, usize>,
}

impl Index {
    /// Entries that don't parse are skipped, so one odd entry can't cost
    /// the rest. `None` if the file isn't a JSON list at all.
    fn parse(bytes: &[u8]) -> Option<Self> {
        let list: Vec<serde_json::Value> = serde_json::from_slice(bytes).ok()?;
        let mut index = Index::default();
        for v in list {
            let Ok(raw) = serde_json::from_value::<Raw>(v) else { continue };
            let m = AnimeMapping::from(raw);
            let i = index.entries.len();
            for (map, id) in
                [(&mut index.anilist, m.anilist_id), (&mut index.mal, m.mal_id), (&mut index.kitsu, m.kitsu_id)]
            {
                if let Some(id) = id {
                    map.entry(id).or_insert(i);
                }
            }
            if let Some(imdb) = &m.imdb_id {
                let better = match index.imdb.get(imdb) {
                    Some(&j) => rank(&m) < rank(&index.entries[j]),
                    None => true,
                };
                if better {
                    index.imdb.insert(imdb.clone(), i);
                }
            }
            index.entries.push(m);
        }
        (!index.entries.is_empty()).then_some(index)
    }

    fn find(&self, key: &AnimeKey) -> Option<&AnimeMapping> {
        let i = match key {
            AnimeKey::Anilist(id) => self.anilist.get(id),
            AnimeKey::Mal(id) => self.mal.get(id),
            AnimeKey::Kitsu(id) => self.kitsu.get(id),
            AnimeKey::Imdb(id) => self.imdb.get(id),
        }?;
        self.entries.get(*i)
    }
}

/// Which of the entries sharing an IMDb id stands for the show: TV before
/// anything else, then the earliest TVDB season, then the oldest AniList id.
fn rank(m: &AnimeMapping) -> (bool, u32, u32) {
    let season = m.season.and_then(|s| s.tvdb.or(s.tmdb)).unwrap_or(1);
    (m.ty.as_deref() != Some("TV"), season, m.anilist_id.unwrap_or(u32::MAX))
}

struct State {
    index: Option<Index>,
    /// When the file in use was downloaded.
    fetched: Option<SystemTime>,
    /// The last download attempt, so a failing one isn't retried at once.
    tried: Option<SystemTime>,
}

pub struct AnimeLists {
    path: PathBuf,
    url: String,
    http: reqwest::Client,
    state: Mutex<State>,
}

impl AnimeLists {
    /// Keeps its file in `cache_dir` (the app's cache folder).
    pub fn new(cache_dir: PathBuf) -> Self {
        Self::with_url(cache_dir, URL)
    }

    fn with_url(cache_dir: PathBuf, url: &str) -> Self {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(60))
            .user_agent(concat!("polar/", env!("CARGO_PKG_VERSION")))
            .build()
            .unwrap_or_default();
        Self {
            path: cache_dir.join(FILE),
            url: url.into(),
            http,
            state: Mutex::new(State { index: None, fetched: None, tried: None }),
        }
    }

    /// The cache file's path.
    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    /// A show's ids, from the kept file, downloading it first if there is
    /// none or it is over a week old (the old one is used if that fails).
    pub async fn find(&self, key: &AnimeKey) -> Option<AnimeMapping> {
        self.find_at(key, SystemTime::now()).await
    }

    async fn find_at(&self, key: &AnimeKey, now: SystemTime) -> Option<AnimeMapping> {
        // Held throughout, so two lookups never download the file twice.
        let mut state = self.state.lock().await;
        if state.index.is_none() {
            self.load(&mut state).await;
        }
        let stale = state.fetched.is_none_or(|t| age(now, t) >= TTL);
        let may_try = state.tried.is_none_or(|t| age(now, t) >= RETRY);
        if stale && may_try {
            state.tried = Some(now);
            if let Some(index) = self.download().await {
                *state = State { index: Some(index), fetched: Some(now), tried: Some(now) };
            }
        }
        state.index.as_ref()?.find(key).cloned()
    }

    /// Forgets the list and deletes the file; it is downloaded again when next needed.
    pub async fn clear(&self) {
        let mut state = self.state.lock().await;
        *state = State { index: None, fetched: None, tried: None };
        let _ = tokio::fs::remove_file(&self.path).await;
    }

    /// Size of the cache file in bytes (0 when there is none).
    pub async fn size(&self) -> u64 {
        tokio::fs::metadata(&self.path).await.map(|m| m.len()).unwrap_or(0)
    }

    /// The kept file, if there is a readable one; its age is its modified time.
    async fn load(&self, state: &mut State) {
        let Ok(bytes) = tokio::fs::read(&self.path).await else { return };
        let modified = tokio::fs::metadata(&self.path).await.and_then(|m| m.modified()).ok();
        if let Some(index) = parse(bytes).await {
            state.index = Some(index);
            state.fetched = modified;
        }
    }

    /// Downloads the list and, if it parses, replaces the file with it.
    async fn download(&self) -> Option<Index> {
        let res = self.http.get(&self.url).send().await.ok()?.error_for_status().ok()?;
        let bytes = res.bytes().await.ok()?.to_vec();
        let (index, bytes) = parse_keep(bytes).await?;
        if let Some(dir) = self.path.parent() {
            let _ = tokio::fs::create_dir_all(dir).await;
        }
        let tmp = self.path.with_extension("json.tmp");
        if tokio::fs::write(&tmp, &bytes).await.is_ok() {
            let _ = tokio::fs::rename(&tmp, &self.path).await;
        }
        Some(index)
    }
}

fn age(now: SystemTime, then: SystemTime) -> Duration {
    now.duration_since(then).unwrap_or_default()
}

/// Parsing 6 MB of JSON takes a moment: off the async threads.
async fn parse(bytes: Vec<u8>) -> Option<Index> {
    tokio::task::spawn_blocking(move || Index::parse(&bytes)).await.ok()?
}

async fn parse_keep(bytes: Vec<u8>) -> Option<(Index, Vec<u8>)> {
    tokio::task::spawn_blocking(move || Index::parse(&bytes).map(|i| (i, bytes))).await.ok()?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    const LIST: &str = r#"[
        {"type":"TV","anidb_id":69,"anilist_id":21,"imdb_id":["tt0000102"],"kitsu_id":12,"mal_id":21,"themoviedb_id":{"tv":37854},"tvdb_id":81797},
        {"type":"TV","anilist_id":21087,"mal_id":31240,"imdb_id":["tt0000109"],"themoviedb_id":{"tv":65844},"tvdb_id":305089,"season":{"tvdb":2,"tmdb":2},"episode_offset":{"tvdb":12}},
        {"type":"TV","anilist_id":20623,"mal_id":28171,"imdb_id":["tt0000109"],"themoviedb_id":{"tv":65844},"tvdb_id":305089,"season":{"tvdb":1,"tmdb":1}},
        {"type":"MOVIE","anilist_id":1,"imdb_id":["tt0000109"],"themoviedb_id":{"movie":9}},
        {"type":"TV","anilist_id":"not a number"},
        {"type":"ONA","kitsu_id":46000,"mal_id":50000}
    ]"#;

    /// A local server answering every request with `body` (status 200, or
    /// 500 when `body` is empty); returns its URL and a request counter.
    async fn serve(body: &'static str) -> (String, Arc<AtomicUsize>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/list.json", listener.local_addr().unwrap());
        let hits = Arc::new(AtomicUsize::new(0));
        let counter = hits.clone();
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = listener.accept().await {
                counter.fetch_add(1, Ordering::SeqCst);
                let mut buf = vec![0; 4096];
                let _ = sock.read(&mut buf).await;
                let status = if body.is_empty() { 500 } else { 200 };
                let res =
                    format!("HTTP/1.1 {status} X\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}", body.len());
                let _ = sock.write_all(res.as_bytes()).await;
            }
        });
        (url, hits)
    }

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("polar-anime-lists-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn lookups_by_every_id() {
        let index = Index::parse(LIST.as_bytes()).unwrap();
        assert_eq!(index.entries.len(), 5, "the malformed entry is skipped");
        let one_piece = index.find(&AnimeKey::Anilist(21)).unwrap();
        assert_eq!(
            (one_piece.imdb_id.as_deref(), one_piece.themoviedb_id, one_piece.thetvdb_id, one_piece.kitsu_id),
            (Some("tt0000102"), Some(37854), Some(81797), Some(12))
        );
        assert_eq!(index.find(&AnimeKey::Mal(21)), Some(one_piece));
        assert_eq!(index.find(&AnimeKey::Kitsu(12)), Some(one_piece));
        assert_eq!(index.find(&AnimeKey::Kitsu(46000)).unwrap().mal_id, Some(50000));
        assert_eq!(index.find(&AnimeKey::Anilist(999)), None);
        // Three entries share tt0000109: the TV entry for season 1.
        assert_eq!(index.find(&AnimeKey::Imdb("tt0000109".into())).unwrap().anilist_id, Some(20623));
        assert_eq!(index.find(&AnimeKey::Anilist(1)).unwrap().themoviedb_id, Some(9));
        assert!(Index::parse(b"{}").is_none() && Index::parse(b"[]").is_none());
    }

    #[test]
    fn named_like_anizip() {
        let index = Index::parse(LIST.as_bytes()).unwrap();
        let json = serde_json::to_string(index.find(&AnimeKey::Anilist(21087)).unwrap()).unwrap();
        assert_eq!(
            json,
            r#"{"type":"TV","anilist_id":21087,"mal_id":31240,"imdb_id":"tt0000109","themoviedb_id":65844,"thetvdb_id":305089,"season":{"tvdb":2,"tmdb":2},"episode_offset":{"tvdb":12}}"#
        );
    }

    #[tokio::test]
    async fn downloaded_once_then_weekly() {
        let (url, hits) = serve(LIST).await;
        let d = dir("weekly");
        let lists = AnimeLists::with_url(d.clone(), &url);
        let t0 = SystemTime::now();
        assert!(lists.find_at(&AnimeKey::Anilist(21), t0).await.is_some());
        assert!(lists.find_at(&AnimeKey::Mal(28171), t0 + Duration::from_secs(60)).await.is_some());
        assert_eq!(hits.load(Ordering::SeqCst), 1);
        assert!(lists.size().await > 0);

        // A restart reads the file.
        let again = AnimeLists::with_url(d.clone(), &url);
        assert!(again.find_at(&AnimeKey::Anilist(21), t0 + Duration::from_secs(60)).await.is_some());
        assert_eq!(hits.load(Ordering::SeqCst), 1);

        // A week on, it is downloaded again.
        again.find_at(&AnimeKey::Anilist(21), t0 + TTL + Duration::from_secs(60)).await;
        assert_eq!(hits.load(Ordering::SeqCst), 2);

        again.clear().await;
        assert_eq!(again.size().await, 0);
        let _ = std::fs::remove_dir_all(d);
    }

    #[tokio::test]
    async fn old_file_kept_when_download_fails() {
        let (good, _) = serve(LIST).await;
        let d = dir("stale");
        let t0 = SystemTime::now();
        AnimeLists::with_url(d.clone(), &good).find_at(&AnimeKey::Anilist(21), t0).await;

        let (bad, hits) = serve("").await;
        let lists = AnimeLists::with_url(d.clone(), &bad);
        let later = t0 + TTL + Duration::from_secs(60);
        assert!(lists.find_at(&AnimeKey::Anilist(21), later).await.is_some());
        // Not retried for an hour.
        assert!(lists.find_at(&AnimeKey::Anilist(21), later + Duration::from_secs(60)).await.is_some());
        assert_eq!(hits.load(Ordering::SeqCst), 1);
        lists.find_at(&AnimeKey::Anilist(21), later + RETRY).await;
        assert_eq!(hits.load(Ordering::SeqCst), 2);
        // The failed downloads didn't replace the file.
        assert!(AnimeLists::with_url(d.clone(), &bad).find_at(&AnimeKey::Mal(21), t0).await.is_some());
        let _ = std::fs::remove_dir_all(d);
    }

    #[tokio::test]
    async fn nothing_without_file_or_network() {
        let (bad, _) = serve("").await;
        let lists = AnimeLists::with_url(dir("none"), &bad);
        assert_eq!(lists.find(&AnimeKey::Anilist(21)).await, None);
    }
}
