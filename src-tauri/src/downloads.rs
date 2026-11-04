//! Downloads: a movie or an episode saved to this device to watch offline.
//!
//! A download is the source's HTTP file copied to `<app data>/downloads`.
//! The list lives beside it in `downloads.json`. Pausing stops the transfer
//! and keeps the partial file; resuming asks for the rest with a Range
//! request (or starts over if the server can't do ranges). A transfer cut off
//! by quitting the app comes back paused.
//!
//! The UI polls `downloads_list` while anything is moving, so there's no
//! event plumbing: progress is just the record's `received` count.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use polar_addon::Stream;
use polar_library::opened::{self, Opened};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};
use tokio::io::AsyncWriteExt;

use crate::commands::{resolve, CmdError, Playable, Result};
use crate::store::now;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DownloadState {
    Downloading,
    Paused,
    Done,
    Failed,
}

/// What the UI sends to start one: the title as its cards draw it, and the source.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadRequest {
    pub meta_id: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub video_id: String,
    pub name: String,
    pub poster: Option<String>,
    pub background: Option<String>,
    pub logo: Option<String>,
    pub season: Option<u32>,
    pub episode: Option<u32>,
    pub episode_title: Option<String>,
    pub thumbnail: Option<String>,
    /// The source's label, e.g. "1080p · HEVC".
    pub quality: String,
    pub stream: Stream,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Download {
    /// The video id: one download per movie or episode.
    pub id: String,
    pub meta_id: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub name: String,
    pub poster: Option<String>,
    pub background: Option<String>,
    pub logo: Option<String>,
    pub season: Option<u32>,
    pub episode: Option<u32>,
    pub episode_title: Option<String>,
    pub thumbnail: Option<String>,
    pub quality: String,
    /// Where the bytes come from (kept for resuming).
    pub url: String,
    /// The file on disk.
    pub file: String,
    pub received: u64,
    pub total: Option<u64>,
    pub state: DownloadState,
    pub error: Option<String>,
    pub added_at: u64,
    /// Request headers the add-on asked for (`behaviorHints.proxyHeaders.request`).
    #[serde(default, skip_serializing_if = "HashMap::is_empty")]
    pub headers: HashMap<String, String>,
}

/// The headers an add-on says its link needs, from `behaviorHints.proxyHeaders.request`.
fn proxy_headers(stream: &Stream) -> HashMap<String, String> {
    stream
        .behavior_hints
        .as_ref()
        .and_then(|h| h.get("proxyHeaders"))
        .and_then(|p| p.get("request"))
        .and_then(|r| r.as_object())
        .map(|o| o.iter().filter_map(|(k, v)| Some((k.clone(), v.as_str()?.to_string()))).collect())
        .unwrap_or_default()
}

#[derive(Default)]
struct Inner {
    items: Vec<Download>,
    /// Running transfers, by id; setting the flag stops one.
    running: HashMap<String, Arc<AtomicBool>>,
}

pub struct Downloads {
    dir: PathBuf,
    inner: Mutex<Inner>,
    http: reqwest::Client,
    /// Why `downloads.json` couldn't be read at start-up: while set, the list
    /// isn't saved over it (critique C1).
    problem: Option<String>,
}

/// True for a path on this machine (what a finished download plays from), not a URL.
pub fn is_local(url: &str) -> bool {
    !url.contains("://") && Path::new(url).is_absolute()
}

impl Downloads {
    pub fn load(app_data: &Path) -> Self {
        let dir = app_data.join("downloads");
        let path = dir.join("downloads.json");
        let (mut items, problem): (Vec<Download>, _) = match opened::open(std::fs::read(&path)) {
            Opened::Data(items) => (items, None),
            Opened::Fresh => (Vec::new(), None),
            // The files are still on disk; keep the record of them before starting over.
            Opened::Corrupt(e) => match std::fs::copy(&path, path.with_extension(format!("corrupt-{}.json", now()))) {
                Ok(_) => (Vec::new(), None),
                Err(copy) => (
                    Vec::new(),
                    Some(format!("{} is damaged ({e}) and couldn't be backed up ({copy})", path.display())),
                ),
            },
            Opened::Unreadable(e) => (Vec::new(), Some(format!("{} couldn't be read ({e})", path.display()))),
        };
        if let Some(problem) = &problem {
            eprintln!("polar: {problem}; not saving the downloads list over it");
        }
        for d in &mut items {
            // Cut off by the app quitting: comes back paused, ready to resume.
            if d.state == DownloadState::Downloading {
                d.state = DownloadState::Paused;
            }
        }
        // A finished file that's gone (deleted by hand) isn't a download any more.
        items.retain(|d| d.state != DownloadState::Done || Path::new(&d.file).exists());
        Self {
            dir,
            inner: Mutex::new(Inner { items, running: HashMap::new() }),
            http: reqwest::Client::builder()
                .user_agent(concat!("polar/", env!("CARGO_PKG_VERSION")))
                .connect_timeout(Duration::from_secs(15))
                .build()
                .unwrap_or_default(),
            problem,
        }
    }

    /// Set when `downloads.json` couldn't be read at start-up.
    pub fn problem(&self) -> Option<&str> {
        self.problem.as_deref()
    }

    /// True when `path` is a finished download's file, so the player may open it.
    pub fn owns(&self, path: &str) -> bool {
        is_local(path)
            && self.inner.lock().unwrap().items.iter().any(|d| d.state == DownloadState::Done && d.file == path)
    }

    fn save(&self, items: &[Download]) {
        if self.problem.is_some() {
            return;
        }
        let _ = std::fs::create_dir_all(&self.dir);
        if let Ok(json) = serde_json::to_vec_pretty(items) {
            let tmp = self.dir.join("downloads.json.tmp");
            if std::fs::write(&tmp, json).is_ok() {
                let _ = std::fs::rename(tmp, self.dir.join("downloads.json"));
            }
        }
    }

    fn update(&self, id: &str, f: impl FnOnce(&mut Download), persist: bool) {
        let mut inner = self.inner.lock().unwrap();
        if let Some(d) = inner.items.iter_mut().find(|d| d.id == id) {
            f(d);
        }
        if persist {
            self.save(&inner.items);
        }
    }

    /// A running transfer updates its own record by file, never a newer one for the same video.
    fn update_file(&self, file: &str, f: impl FnOnce(&mut Download), persist: bool) {
        let mut inner = self.inner.lock().unwrap();
        if let Some(d) = inner.items.iter_mut().find(|d| d.file == file) {
            f(d);
        }
        if persist {
            self.save(&inner.items);
        }
    }

    fn get(&self, id: &str) -> Option<Download> {
        self.inner.lock().unwrap().items.iter().find(|d| d.id == id).cloned()
    }

    fn stop(&self, id: &str) {
        if let Some(flag) = self.inner.lock().unwrap().running.remove(id) {
            flag.store(true, Ordering::Relaxed);
        }
    }

    /// Start (or continue) the transfer for `id` in the background.
    fn spawn(self: &Arc<Self>, id: String) {
        let flag = Arc::new(AtomicBool::new(false));
        let file = {
            let mut inner = self.inner.lock().unwrap();
            if inner.running.contains_key(&id) {
                return;
            }
            let Some(d) = inner.items.iter_mut().find(|d| d.id == id) else { return };
            d.state = DownloadState::Downloading;
            d.error = None;
            let file = d.file.clone();
            inner.running.insert(id.clone(), flag.clone());
            self.save(&inner.items);
            file
        };
        let me = self.clone();
        tauri::async_runtime::spawn(async move {
            let outcome = me.transfer(&file, &flag).await;
            let mut inner = me.inner.lock().unwrap();
            // Only the transfer still registered may clear itself (a restart may have replaced it).
            if inner.running.get(&id).is_some_and(|f| Arc::ptr_eq(f, &flag)) {
                inner.running.remove(&id);
            }
            // Removed or replaced while running: the file was still open then, so delete it now.
            if !inner.items.iter().any(|d| d.file == file) {
                let _ = std::fs::remove_file(&file);
                return;
            }
            if let Some(d) = inner.items.iter_mut().find(|d| d.file == file) {
                match outcome {
                    Ok(true) => {
                        d.state = DownloadState::Done;
                        d.total = Some(d.received);
                    }
                    // Stopped on purpose: pause already set the state (or it was removed).
                    Ok(false) => {}
                    Err(e) => {
                        d.state = DownloadState::Failed;
                        d.error = Some(e);
                    }
                }
            }
            me.save(&inner.items);
        });
    }

    /// Copy the file down. Ok(true) when finished, Ok(false) when stopped.
    async fn transfer(&self, file: &str, stop: &AtomicBool) -> std::result::Result<bool, String> {
        let Some(d) = self.inner.lock().unwrap().items.iter().find(|d| d.file == file).cloned() else {
            return Ok(false);
        };
        let path = PathBuf::from(file);
        // Each start writes a new file, so whatever is on disk is this download's own.
        let have = tokio::fs::metadata(&path).await.map(|m| m.len()).unwrap_or(0);

        // Always ask for a range, as a video player does: some file hosts
        // refuse a plain GET with 400.
        let mut req = self.http.get(&d.url).header(reqwest::header::RANGE, format!("bytes={have}-"));
        for (k, v) in &d.headers {
            req = req.header(k.as_str(), v.as_str());
        }
        let mut res = req.send().await.map_err(|e| format!("Couldn't reach the source: {e}"))?;
        let status = res.status();
        if !status.is_success() {
            if status.as_u16() == 403 || status.as_u16() == 410 {
                return Err("The source link expired. Choose another source.".into());
            }
            // What the server said, briefly: the status alone rarely explains it.
            let body = res.text().await.unwrap_or_default();
            let said: String = body.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(140).collect();
            return Err(if said.is_empty() {
                format!("The source answered {status}.")
            } else {
                format!("The source answered {status}: {said}")
            });
        }
        // 206: the rest of the file. 200: the whole file again (no range support).
        let resumed = have > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT;
        let start = if resumed { have } else { 0 };
        let total = res.content_length().map(|n| n + start);
        self.update_file(
            file,
            |d| {
                d.received = start;
                d.total = total;
            },
            true,
        );

        let mut out = tokio::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .append(resumed)
            .truncate(!resumed)
            .open(&path)
            .await
            .map_err(|e| format!("Couldn't write the file: {e}"))?;

        let mut received = start;
        let mut last_save = Instant::now();
        loop {
            if stop.load(Ordering::Relaxed) {
                let _ = out.flush().await;
                return Ok(false);
            }
            match res.chunk().await {
                Ok(Some(bytes)) => {
                    out.write_all(&bytes).await.map_err(|e| format!("Couldn't write the file: {e}"))?;
                    received += bytes.len() as u64;
                    let persist = last_save.elapsed() > Duration::from_secs(5);
                    if persist {
                        last_save = Instant::now();
                    }
                    self.update_file(file, |d| d.received = received, persist);
                }
                Ok(None) => break,
                Err(e) => {
                    let _ = out.flush().await;
                    return Err(format!("The download was interrupted: {e}"));
                }
            }
        }
        out.flush().await.map_err(|e| format!("Couldn't write the file: {e}"))?;
        if total.is_some_and(|t| received < t) {
            return Err("The download ended early.".into());
        }
        Ok(true)
    }
}

/// A file extension for what the source serves; mpv sniffs the real format anyway.
fn extension(url: &str) -> &'static str {
    let path = url.split(['?', '#']).next().unwrap_or("").to_ascii_lowercase();
    for ext in ["mp4", "m4v", "webm", "avi", "mov", "ts"] {
        if path.ends_with(&format!(".{ext}")) {
            return ext;
        }
    }
    "mkv"
}

/// A new name per start, so a restart never writes into a file an older transfer still holds.
fn file_name(id: &str, url: &str, stamp: u64) -> String {
    let safe: String = id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' { c } else { '_' }).collect();
    format!("{safe}-{stamp}.{}", extension(url))
}

type Shared<'a> = State<'a, Arc<Downloads>>;

#[tauri::command]
pub fn downloads_list(downloads: Shared<'_>) -> Vec<Download> {
    let mut items = downloads.inner.lock().unwrap().items.clone();
    items.sort_by_key(|i| std::cmp::Reverse(i.added_at));
    items
}

#[tauri::command]
pub async fn download_start(downloads: Shared<'_>, req: DownloadRequest) -> Result<Download> {
    let url = match resolve(req.stream.clone()) {
        Playable::Url { url } if !is_local(&url) => url,
        Playable::Url { .. } => return Err(CmdError::Other("This is already on your device.".into())),
        Playable::External { .. } => {
            return Err(CmdError::Other("This source plays in a browser and can't be downloaded.".into()))
        }
        Playable::Unsupported { reason } => return Err(CmdError::Other(reason)),
    };
    // Starting again replaces whatever was there (a failed or expired one).
    downloads.stop(&req.video_id);
    let added_at = now();
    let file = downloads.dir.join(file_name(&req.video_id, &url, added_at));
    std::fs::create_dir_all(&downloads.dir)
        .map_err(|e| CmdError::Other(format!("Couldn't create the downloads folder: {e}")))?;
    let d = Download {
        id: req.video_id.clone(),
        meta_id: req.meta_id,
        ty: req.ty,
        name: req.name,
        poster: req.poster,
        background: req.background,
        logo: req.logo,
        season: req.season,
        episode: req.episode,
        episode_title: req.episode_title,
        thumbnail: req.thumbnail,
        quality: req.quality,
        url,
        file: file.to_string_lossy().into_owned(),
        received: 0,
        total: None,
        state: DownloadState::Downloading,
        error: None,
        added_at,
        headers: proxy_headers(&req.stream),
    };
    {
        let mut inner = downloads.inner.lock().unwrap();
        // The old file goes now if nothing holds it; a running transfer deletes it when it stops.
        if let Some(old) = inner.items.iter().find(|x| x.id == d.id) {
            let _ = std::fs::remove_file(&old.file);
        }
        inner.items.retain(|x| x.id != d.id);
        inner.items.push(d.clone());
        downloads.save(&inner.items);
    }
    downloads.inner().spawn(d.id.clone());
    Ok(d)
}

#[tauri::command]
pub fn download_pause(downloads: Shared<'_>, id: String) {
    downloads.stop(&id);
    downloads.update(
        &id,
        |d| {
            if d.state == DownloadState::Downloading {
                d.state = DownloadState::Paused;
            }
        },
        true,
    );
}

#[tauri::command]
pub fn download_resume(downloads: Shared<'_>, id: String) {
    if downloads.get(&id).is_some_and(|d| d.state != DownloadState::Done) {
        downloads.inner().spawn(id);
    }
}

/// Show a download's file in Explorer / Finder. By id, so the webview can't point it anywhere else.
#[tauri::command]
pub fn download_reveal(downloads: Shared<'_>, id: String) -> Result<()> {
    let file = downloads.get(&id).map(|d| d.file).ok_or_else(|| CmdError::Other("No such download.".into()))?;
    if !Path::new(&file).exists() {
        return Err(CmdError::Other("The file isn't there any more.".into()));
    }
    tauri_plugin_opener::reveal_item_in_dir(&file).map_err(|e| CmdError::Other(e.to_string()))
}

/// Cancel and delete: the record and the file.
#[tauri::command]
pub fn download_remove(downloads: Shared<'_>, id: String) {
    downloads.stop(&id);
    let mut inner = downloads.inner.lock().unwrap();
    if let Some(d) = inner.items.iter().find(|d| d.id == id) {
        let _ = std::fs::remove_file(&d.file);
    }
    inner.items.retain(|d| d.id != id);
    downloads.save(&inner.items);
}

/// Called once at startup so the managed state exists before any command runs.
pub fn manage(app: &AppHandle, app_data: &Path) {
    app.manage(Arc::new(Downloads::load(app_data)));
}
