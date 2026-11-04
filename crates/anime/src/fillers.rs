//! Filler and recap episodes of an anime, by MyAnimeList id, for the episode
//! badges and "Skip filler".
//!
//! - Jikan (api.jikan.moe, an unofficial MyAnimeList API) first: it knows
//!   filler and recaps. It allows 3 requests a second, so long shows' pages
//!   are fetched one after another.
//! - animefillerlist.com when Jikan is unreachable or knows nothing: filler
//!   only, scraped from the show page by the show's name slugs (the site has
//!   no API and sends no CORS headers, hence here and not in the webview).
//!
//! Answers are kept in one file, `fillers.json` in the app's cache folder, so
//! a show's page doesn't ask either site again for 24 hours, restarts
//! included. Older answers stay for [`KEEP`] as a fallback while both sites
//! are down, and at most [`MAX_ENTRIES`] shows are kept, so the file stays
//! well under a megabyte. Deleting it (or [`Fillers::clear`]) only costs a
//! refetch.

use std::collections::BTreeMap;
use std::path::PathBuf;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tokio::sync::Mutex;

/// How long an answer is used before asking again.
pub const TTL: Duration = Duration::from_secs(24 * 60 * 60);
/// How long an answer is kept as a fallback for when both sites are down.
pub const KEEP: Duration = Duration::from_secs(30 * 24 * 60 * 60);
/// Shows kept at most; the ones fetched longest ago go first.
pub const MAX_ENTRIES: usize = 500;

const FILE: &str = "fillers.json";
const VERSION: u32 = 1;
const JIKAN: &str = "https://api.jikan.moe/v4";
const ANIMEFILLERLIST: &str = "https://www.animefillerlist.com/shows";
/// Jikan pages at most (100 episodes each).
const MAX_PAGES: u32 = 30;
/// "Too many requests" answers waited out before giving up.
const MAX_RETRIES: u32 = 5;

/// Which episodes (by number) are filler and which are recaps.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpisodeFlags {
    pub filler: Vec<u32>,
    pub recap: Vec<u32>,
    /// Who said so; `None` when nothing is known (never fetched, both down).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<Source>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Source {
    Jikan,
    AnimeFillerList,
}

/// One show's answer as kept on disk.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    /// Unix seconds.
    fetched_at: u64,
    #[serde(flatten)]
    flags: EpisodeFlags,
}

/// The file: answers by MAL id.
#[derive(Debug, Default, Serialize, Deserialize)]
struct CacheFile {
    version: u32,
    entries: BTreeMap<u32, Entry>,
}

pub struct Fillers {
    path: PathBuf,
    http: reqwest::Client,
    jikan: String,
    animefillerlist: String,
    /// Pause between Jikan pages, and after a "too many requests".
    pace: Duration,
    backoff: Duration,
    /// Loaded from the file on first use.
    cache: Mutex<Option<BTreeMap<u32, Entry>>>,
}

impl Fillers {
    /// Keeps its file in `cache_dir` (the app's cache folder).
    pub fn new(cache_dir: PathBuf) -> Self {
        Self::with_endpoints(cache_dir, JIKAN, ANIMEFILLERLIST)
    }

    fn with_endpoints(cache_dir: PathBuf, jikan: &str, animefillerlist: &str) -> Self {
        let http = reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .user_agent(concat!("polar/", env!("CARGO_PKG_VERSION")))
            .build()
            .unwrap_or_default();
        Self {
            path: cache_dir.join(FILE),
            http,
            jikan: jikan.into(),
            animefillerlist: animefillerlist.into(),
            pace: Duration::from_millis(400),
            backoff: Duration::from_millis(1500),
            cache: Mutex::new(None),
        }
    }

    /// The cache file's path.
    pub fn path(&self) -> &PathBuf {
        &self.path
    }

    /// A show's filler and recap episodes: from the cache if it is under a
    /// day old, else fetched (Jikan, then animefillerlist.com by `slugs`).
    /// When both fail, the last answer kept, else nothing.
    pub async fn get(&self, mal_id: u32, slugs: &[String]) -> EpisodeFlags {
        self.get_at(mal_id, slugs, now()).await
    }

    async fn get_at(&self, mal_id: u32, slugs: &[String], now: u64) -> EpisodeFlags {
        let kept = self.with_cache(|c| c.get(&mal_id).cloned()).await;
        if let Some(e) = &kept {
            if now.saturating_sub(e.fetched_at) < TTL.as_secs() {
                return e.flags.clone();
            }
        }
        // Not holding the cache while fetching: other shows stay answerable.
        match self.fetch(mal_id, slugs).await {
            Some(flags) => {
                let entry = Entry { fetched_at: now, flags: flags.clone() };
                let file = self
                    .with_cache(|c| {
                        c.insert(mal_id, entry);
                        prune(c, now);
                        serde_json::to_vec(&CacheFile { version: VERSION, entries: c.clone() })
                    })
                    .await;
                if let Ok(bytes) = file {
                    self.write(&bytes).await;
                }
                flags
            }
            None => kept.map(|e| e.flags).unwrap_or_default(),
        }
    }

    /// Forgets every answer and deletes the file.
    pub async fn clear(&self) {
        let mut cache = self.cache.lock().await;
        *cache = Some(BTreeMap::new());
        let _ = tokio::fs::remove_file(&self.path).await;
    }

    /// Size of the cache file in bytes (0 when there is none).
    pub async fn size(&self) -> u64 {
        tokio::fs::metadata(&self.path).await.map(|m| m.len()).unwrap_or(0)
    }

    async fn with_cache<T>(&self, f: impl FnOnce(&mut BTreeMap<u32, Entry>) -> T) -> T {
        let mut cache = self.cache.lock().await;
        if cache.is_none() {
            *cache = Some(self.read().await);
        }
        f(cache.as_mut().unwrap())
    }

    /// The file's entries; none if it is missing, unreadable or from another version.
    async fn read(&self) -> BTreeMap<u32, Entry> {
        let Ok(bytes) = tokio::fs::read(&self.path).await else { return BTreeMap::new() };
        match serde_json::from_slice::<CacheFile>(&bytes) {
            Ok(f) if f.version == VERSION => f.entries,
            _ => BTreeMap::new(),
        }
    }

    /// Replaces the file in one step, so a crash never leaves half of it.
    async fn write(&self, bytes: &[u8]) {
        if let Some(dir) = self.path.parent() {
            let _ = tokio::fs::create_dir_all(dir).await;
        }
        let tmp = self.path.with_extension("json.tmp");
        if tokio::fs::write(&tmp, bytes).await.is_ok() {
            let _ = tokio::fs::rename(&tmp, &self.path).await;
        }
    }

    /// Jikan's answer, or animefillerlist.com's when Jikan fails or knows no
    /// filler. `None` when nothing could be learned, so nothing is cached.
    async fn fetch(&self, mal_id: u32, slugs: &[String]) -> Option<EpisodeFlags> {
        let jikan = self.jikan(mal_id).await;
        if let Some(f) = &jikan {
            if !f.filler.is_empty() || slugs.is_empty() {
                return jikan;
            }
        }
        match self.animefillerlist(slugs).await {
            Some(filler) if !filler.is_empty() => {
                Some(EpisodeFlags { filler, recap: Vec::new(), source: Some(Source::AnimeFillerList) })
            }
            // Jikan's answer (perhaps "recaps only"), or nothing if it failed.
            _ => jikan,
        }
    }

    /// All of a show's flagged episodes from Jikan, or `None` if any page failed.
    async fn jikan(&self, mal_id: u32) -> Option<EpisodeFlags> {
        let mut flags = EpisodeFlags { source: Some(Source::Jikan), ..Default::default() };
        let (mut page, mut retries) = (1, 0);
        while page <= MAX_PAGES {
            let url = format!("{}/anime/{mal_id}/episodes?page={page}", self.jikan);
            let timeout = Duration::from_secs(if page == 1 { 6 } else { 12 });
            let res = self.http.get(url).timeout(timeout).send().await.ok()?;
            match res.status().as_u16() {
                429 if retries < MAX_RETRIES => {
                    retries += 1;
                    tokio::time::sleep(self.backoff).await;
                    continue;
                }
                // Jikan doesn't know the show: a real answer, nothing flagged.
                404 => return Some(flags),
                s if !(200..300).contains(&s) => return None,
                _ => {}
            }
            let body: JikanPage = res.json().await.ok()?;
            for e in body.data {
                if e.filler == Some(true) {
                    flags.filler.push(e.mal_id);
                }
                if e.recap == Some(true) {
                    flags.recap.push(e.mal_id);
                }
            }
            if !body.pagination.has_next_page {
                return Some(flags);
            }
            page += 1;
            tokio::time::sleep(self.pace).await;
        }
        Some(flags)
    }

    /// Filler episodes from the first slug animefillerlist.com has a list
    /// for: empty if it has none, `None` if the site couldn't be reached.
    async fn animefillerlist(&self, slugs: &[String]) -> Option<Vec<u32>> {
        let mut reached = false;
        for slug in slugs {
            let valid = !slug.is_empty() && slug.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
            if !valid {
                continue;
            }
            let url = format!("{}/{slug}", self.animefillerlist);
            let Ok(res) = self.http.get(url).timeout(Duration::from_secs(10)).send().await else { continue };
            reached = true;
            if !res.status().is_success() {
                continue;
            }
            let Ok(html) = res.text().await else { continue };
            if let Some(eps) = parse_animefillerlist(&html) {
                return Some(eps);
            }
        }
        reached.then(Vec::new)
    }
}

#[derive(Deserialize)]
struct JikanPage {
    pagination: JikanPagination,
    data: Vec<JikanEpisode>,
}

#[derive(Deserialize)]
struct JikanPagination {
    has_next_page: bool,
}

/// `mal_id` is the episode number; the flags can be null.
#[derive(Deserialize)]
struct JikanEpisode {
    mal_id: u32,
    filler: Option<bool>,
    recap: Option<bool>,
}

/// Drops answers older than [`KEEP`], then the oldest beyond [`MAX_ENTRIES`].
fn prune(entries: &mut BTreeMap<u32, Entry>, now: u64) {
    entries.retain(|_, e| now.saturating_sub(e.fetched_at) < KEEP.as_secs());
    if entries.len() > MAX_ENTRIES {
        let mut ages: Vec<(u64, u32)> = entries.iter().map(|(id, e)| (e.fetched_at, *id)).collect();
        ages.sort_unstable();
        for (_, id) in &ages[..ages.len() - MAX_ENTRIES] {
            entries.remove(id);
        }
    }
}

/// The filler block's episode numbers ("33, 50, 64-108" in a
/// `<div class="filler">`), or `None` if the page has no such block.
fn parse_animefillerlist(html: &str) -> Option<Vec<u32>> {
    let block = html.split(r#"<div class="filler">"#).nth(1)?;
    let list = block.split(r#"<span class="Episodes">"#).nth(1)?;
    let list = &list[..list.find("</span>")?];
    let mut out = Vec::new();
    // Each range is the text of an <a>: ">64-108</a>".
    for part in list.split("</a>") {
        let Some(text) = part.rsplit('>').next() else { continue };
        let mut ends = text.trim().splitn(2, '-').map(|n| n.trim().parse::<u32>());
        match (ends.next(), ends.next()) {
            (Some(Ok(a)), None) => out.push(a),
            (Some(Ok(a)), Some(Ok(b))) if b >= a && b - a < 2000 => out.extend(a..=b),
            _ => {}
        }
    }
    Some(out)
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    const DAY: u64 = 24 * 60 * 60;
    const T0: u64 = 1_800_000_000;

    /// A local HTTP server answering each request path with `route(path)`
    /// (status, body); returns its base URL and a request counter.
    async fn serve(route: impl Fn(&str) -> (u16, String) + Send + Sync + 'static) -> (String, Arc<AtomicUsize>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let hits = Arc::new(AtomicUsize::new(0));
        let (route, counter) = (Arc::new(route), hits.clone());
        tokio::spawn(async move {
            while let Ok((mut sock, _)) = listener.accept().await {
                let (route, counter) = (route.clone(), counter.clone());
                tokio::spawn(async move {
                    let mut buf = vec![0; 4096];
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    let req = String::from_utf8_lossy(&buf[..n]);
                    let path = req.split_whitespace().nth(1).unwrap_or("/").to_string();
                    counter.fetch_add(1, Ordering::SeqCst);
                    let (status, body) = route(&path);
                    let res = format!(
                        "HTTP/1.1 {status} X\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                        body.len()
                    );
                    let _ = sock.write_all(res.as_bytes()).await;
                });
            }
        });
        (base, hits)
    }

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("polar-anime-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    fn fillers(dir: PathBuf, jikan: &str, afl: &str) -> Fillers {
        let mut f = Fillers::with_endpoints(dir, jikan, afl);
        f.pace = Duration::ZERO;
        f.backoff = Duration::ZERO;
        f
    }

    fn page(eps: &[(u32, bool, bool)], next: bool) -> String {
        let data: Vec<_> = eps
            .iter()
            .map(|(n, f, r)| serde_json::json!({ "mal_id": n, "filler": f, "recap": r, "title": "x" }))
            .collect();
        serde_json::json!({ "pagination": { "has_next_page": next }, "data": data }).to_string()
    }

    const AFL_PAGE: &str = r#"<div class="filler"><span class="Label">Filler Episodes:</span><span class="Episodes"><a href="javascript://" onclick="jumpToNum(33);">33</a>, <a href="x">64-66</a></span></div>"#;

    #[test]
    fn parses_animefillerlist_ranges() {
        assert_eq!(parse_animefillerlist(AFL_PAGE), Some(vec![33, 64, 65, 66]));
        assert_eq!(parse_animefillerlist("<html>no list</html>"), None);
    }

    #[tokio::test]
    async fn jikan_pages_and_rate_limit() {
        let tries = Arc::new(AtomicUsize::new(0));
        let t = tries.clone();
        let (jikan, _) = serve(move |path| match path {
            "/anime/20/episodes?page=1" => (200, page(&[(1, false, false), (2, true, false), (3, false, true)], true)),
            // Rate-limited once, then answered.
            "/anime/20/episodes?page=2" if t.fetch_add(1, Ordering::SeqCst) == 0 => (429, String::new()),
            "/anime/20/episodes?page=2" => (200, page(&[(101, true, false), (102, false, false)], false)),
            _ => (404, String::new()),
        })
        .await;
        let f = fillers(dir("pages"), &jikan, "http://127.0.0.1:9");
        let flags = f.get_at(20, &[], T0).await;
        assert_eq!(flags.filler, vec![2, 101]);
        assert_eq!(flags.recap, vec![3]);
        assert_eq!(flags.source, Some(Source::Jikan));
        assert_eq!(tries.load(Ordering::SeqCst), 2);
    }

    #[tokio::test]
    async fn cached_for_a_day_on_disk() {
        let (jikan, hits) = serve(|_| (200, page(&[(5, true, false)], false))).await;
        let d = dir("ttl");
        let f = fillers(d.clone(), &jikan, "http://127.0.0.1:9");
        assert_eq!(f.get_at(1, &[], T0).await.filler, vec![5]);
        assert_eq!(f.get_at(1, &[], T0 + DAY - 1).await.filler, vec![5]);
        assert_eq!(hits.load(Ordering::SeqCst), 1);
        assert!(f.size().await > 0);

        // A restart reads the file instead of asking again.
        let again = fillers(d.clone(), &jikan, "http://127.0.0.1:9");
        assert_eq!(again.get_at(1, &[], T0 + 60).await.filler, vec![5]);
        assert_eq!(hits.load(Ordering::SeqCst), 1);

        // After a day it asks again.
        again.get_at(1, &[], T0 + DAY).await;
        assert_eq!(hits.load(Ordering::SeqCst), 2);

        again.clear().await;
        assert_eq!(again.size().await, 0);
        let _ = std::fs::remove_dir_all(d);
    }

    #[tokio::test]
    async fn stale_answer_when_both_sites_are_down() {
        let (jikan, _) = serve(|_| (200, page(&[(7, true, false)], false))).await;
        let d = dir("stale");
        fillers(d.clone(), &jikan, "http://127.0.0.1:9").get_at(1, &[], T0).await;
        let (down, _) = serve(|_| (503, String::new())).await;
        let offline = fillers(d.clone(), &down, &down);
        let slugs = vec!["kazeori".to_string()];
        assert_eq!(offline.get_at(1, &slugs, T0 + 2 * DAY).await.filler, vec![7]);
        // Never fetched and both down: nothing, and nothing written.
        assert_eq!(offline.get_at(2, &slugs, T0 + 2 * DAY).await, EpisodeFlags::default());
        assert!(!offline.with_cache(|c| c.contains_key(&2)).await);
        let _ = std::fs::remove_dir_all(d);
    }

    #[tokio::test]
    async fn animefillerlist_when_jikan_knows_no_filler() {
        let (jikan, _) = serve(|_| (200, page(&[(1, false, true)], false))).await;
        let (afl, _) = serve(|path| match path {
            "/kazeori" => (200, AFL_PAGE.to_string()),
            _ => (404, String::new()),
        })
        .await;
        let f = fillers(dir("afl"), &jikan, &afl);
        let slugs = vec!["bad slug!".to_string(), "kazeori-tv".to_string(), "kazeori".to_string()];
        let flags = f.get_at(1, &slugs, T0).await;
        assert_eq!(flags.filler, vec![33, 64, 65, 66]);
        assert_eq!(flags.source, Some(Source::AnimeFillerList));

        // Neither knows filler: Jikan's recaps stay.
        let f = fillers(dir("afl2"), &jikan, &afl);
        let flags = f.get_at(1, &["paleblade".to_string()], T0).await;
        assert_eq!((flags.filler.len(), flags.recap, flags.source), (0, vec![1], Some(Source::Jikan)));
    }

    #[test]
    fn prune_drops_old_then_oldest() {
        let entry = |at| Entry { fetched_at: at, flags: EpisodeFlags::default() };
        let mut m: BTreeMap<u32, Entry> = (0..MAX_ENTRIES as u32 + 10).map(|i| (i, entry(T0 + i as u64))).collect();
        m.insert(9999, entry(T0 - KEEP.as_secs() - 1 + 1000));
        prune(&mut m, T0 + 1000);
        assert_eq!(m.len(), MAX_ENTRIES);
        assert!(!m.contains_key(&9999) && !m.contains_key(&9) && m.contains_key(&10));
    }

    #[test]
    fn file_format() {
        let mut entries = BTreeMap::new();
        entries.insert(
            20,
            Entry {
                fetched_at: T0,
                flags: EpisodeFlags { filler: vec![2], recap: vec![], source: Some(Source::Jikan) },
            },
        );
        let json = serde_json::to_string(&CacheFile { version: VERSION, entries }).unwrap();
        assert_eq!(
            json,
            r#"{"version":1,"entries":{"20":{"fetchedAt":1800000000,"filler":[2],"recap":[],"source":"jikan"}}}"#
        );
    }
}
