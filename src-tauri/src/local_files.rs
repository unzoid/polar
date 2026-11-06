//! Video files on this device that the user opened (#204): dropped on the window, picked in the
//! file dialog, or opened again from Recent files. The player opens these and the other videos in
//! their folder (for Next Episode), never a path the page names by itself (`mpv_load`).
//!
//! Recent files are kept in `recent-files.json` in the app's local data folder. They stay on this
//! device: file paths are personal, so they are never synced.

use std::cmp::Ordering;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};

use crate::commands::CmdError;
use crate::locks::Locked;

/// What a video file can end in. Anything else dropped on the window is left out.
pub const VIDEO_EXTENSIONS: &[&str] =
    &["mp4", "m4v", "mkv", "webm", "mov", "avi", "wmv", "flv", "ts", "m2ts", "mts", "mpg", "mpeg", "ogv", "3gp", "vob"];

/// How many recent files are kept.
const RECENT_MAX: usize = 30;

/// Sent with the files dropped on the window, once the player may open them.
pub const DROPPED_EVENT: &str = "local-files://dropped";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LocalFile {
    pub path: String,
    /// The file's name, with its extension.
    pub name: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RecentFile {
    pub path: String,
    pub name: String,
    #[serde(default)]
    pub size: u64,
    /// Where playback stopped, in seconds.
    #[serde(default)]
    pub position: f64,
    #[serde(default)]
    pub duration: f64,
    /// Unix milliseconds.
    #[serde(default)]
    pub opened_at: u64,
}

pub struct LocalFiles {
    file: PathBuf,
    granted: Mutex<HashSet<String>>,
    recent: Mutex<Vec<RecentFile>>,
}

impl LocalFiles {
    fn load(file: PathBuf) -> Self {
        let recent: Vec<RecentFile> =
            std::fs::read(&file).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
        Self { file, granted: Mutex::default(), recent: Mutex::new(recent) }
    }

    /// True when the player may open `path`.
    pub fn owns(&self, path: &str) -> bool {
        self.granted.locked().contains(path)
    }

    /// The videos among `paths` (a folder stands for the videos in it), which the player may then open.
    fn grant(&self, paths: impl IntoIterator<Item = PathBuf>) -> Vec<LocalFile> {
        let mut files = Vec::new();
        for path in paths {
            if path.is_dir() {
                files.extend(videos_in(&path));
            } else if let Some(f) = video_file(&path) {
                files.push(f);
            }
        }
        let mut granted = self.granted.locked();
        granted.extend(files.iter().map(|f| f.path.clone()));
        files
    }

    fn save(&self, recent: &[RecentFile]) {
        if let Ok(json) = serde_json::to_vec(recent) {
            if let Err(e) = polar_library::saver::write_atomic(&self.file, &json) {
                tracing::warn!("recent files weren't saved: {e}");
            }
        }
    }
}

pub fn manage(app: &AppHandle) -> tauri::Result<()> {
    let file = app.path().app_local_data_dir()?.join("recent-files.json");
    app.manage(Arc::new(LocalFiles::load(file)));
    Ok(())
}

/// Files dropped on the window: allowed, then handed to the page.
pub fn dropped(app: &AppHandle, paths: Vec<PathBuf>) {
    let files = app.state::<Arc<LocalFiles>>().grant(paths);
    if let Err(e) = app.emit(DROPPED_EVENT, files) {
        tracing::warn!("dropped files weren't passed on: {e}");
    }
}

fn is_video(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| VIDEO_EXTENSIONS.iter().any(|v| v.eq_ignore_ascii_case(e)))
}

fn video_file(path: &Path) -> Option<LocalFile> {
    if !is_video(path) || !path.is_absolute() {
        return None;
    }
    let meta = std::fs::metadata(path).ok().filter(|m| m.is_file())?;
    Some(LocalFile {
        path: path.to_string_lossy().into_owned(),
        name: path.file_name()?.to_string_lossy().into_owned(),
        size: meta.len(),
    })
}

/// The videos directly in `dir`, in episode order.
fn videos_in(dir: &Path) -> Vec<LocalFile> {
    let Ok(entries) = std::fs::read_dir(dir) else { return Vec::new() };
    let mut files: Vec<LocalFile> = entries.flatten().filter_map(|e| video_file(&e.path())).collect();
    files.sort_by(|a, b| natural_cmp(&a.name, &b.name));
    files
}

/// Names compared as people number them: "Episode 2" before "Episode 10".
pub fn natural_cmp(a: &str, b: &str) -> Ordering {
    let (mut a, mut b) = (a.chars().peekable(), b.chars().peekable());
    loop {
        match (a.peek().copied(), b.peek().copied()) {
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
            (Some(x), Some(y)) if x.is_ascii_digit() && y.is_ascii_digit() => {
                let take = |it: &mut std::iter::Peekable<std::str::Chars>| {
                    let mut n = String::new();
                    while let Some(c) = it.peek().copied().filter(char::is_ascii_digit) {
                        n.push(c);
                        it.next();
                    }
                    n
                };
                let (m, n) = (take(&mut a), take(&mut b));
                let (m, n) = (m.trim_start_matches('0'), n.trim_start_matches('0'));
                let ord = m.len().cmp(&n.len()).then_with(|| m.cmp(n));
                if ord != Ordering::Equal {
                    return ord;
                }
            }
            (Some(x), Some(y)) => {
                let ord = x.to_lowercase().cmp(y.to_lowercase());
                if ord != Ordering::Equal {
                    return ord;
                }
                a.next();
                b.next();
            }
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// The system's file dialog; the videos picked (none when it's cancelled).
#[tauri::command]
pub async fn local_pick(app: AppHandle, files: State<'_, Arc<LocalFiles>>) -> Result<Vec<LocalFile>, CmdError> {
    #[cfg(desktop)]
    {
        use tauri_plugin_dialog::DialogExt;
        let (tx, rx) = tokio::sync::oneshot::channel();
        app.dialog().file().set_title("Open video files").add_filter("Videos", VIDEO_EXTENSIONS).pick_files(
            move |picked| {
                let _ = tx.send(picked);
            },
        );
        let picked = rx.await.ok().flatten().unwrap_or_default();
        Ok(files.grant(picked.into_iter().filter_map(|p| p.into_path().ok())))
    }
    #[cfg(not(desktop))]
    {
        let _ = (app, files);
        Err(CmdError::Unsupported("Opening files isn't available on this device yet.".into()))
    }
}

/// The other videos in the folder of `path` (an opened file), in order, which the player may then open.
#[tauri::command]
pub fn local_folder(files: State<'_, Arc<LocalFiles>>, path: String) -> Result<Vec<LocalFile>, CmdError> {
    if !files.owns(&path) {
        return Err(CmdError::Unsupported("Only files you opened can be played.".into()));
    }
    let dir = Path::new(&path).parent().ok_or_else(|| CmdError::NotFound("This file has no folder.".into()))?;
    let videos = videos_in(dir);
    files.granted.locked().extend(videos.iter().map(|f| f.path.clone()));
    Ok(videos)
}

#[tauri::command]
pub fn local_recent(files: State<'_, Arc<LocalFiles>>) -> Vec<RecentFile> {
    files.recent.locked().clone()
}

/// Open a recent file again; fails when it's no longer on this device.
#[tauri::command]
pub fn local_reopen(files: State<'_, Arc<LocalFiles>>, path: String) -> Result<LocalFile, CmdError> {
    if !files.recent.locked().iter().any(|r| r.path == path) {
        return Err(CmdError::Unsupported("Only files you opened can be played.".into()));
    }
    files
        .grant([PathBuf::from(&path)])
        .pop()
        .ok_or_else(|| CmdError::NotFound("This file is no longer on this device.".into()))
}

/// Where playback of `path` is; `opened` moves it to the top of Recent files.
#[tauri::command]
pub fn local_seen(
    files: State<'_, Arc<LocalFiles>>,
    path: String,
    position: f64,
    duration: f64,
    opened: bool,
) -> Result<(), CmdError> {
    if !files.owns(&path) {
        return Err(CmdError::Unsupported("Only files you opened can be played.".into()));
    }
    let mut recent = files.recent.locked();
    let at = recent.iter().position(|r| r.path == path);
    let mut entry = match at {
        Some(i) => recent.remove(i),
        None => {
            let p = Path::new(&path);
            RecentFile {
                name: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.clone()),
                size: std::fs::metadata(p).map(|m| m.len()).unwrap_or(0),
                path: path.clone(),
                position: 0.0,
                duration: 0.0,
                opened_at: 0,
            }
        }
    };
    if position.is_finite() && position >= 0.0 {
        entry.position = position;
    }
    if duration.is_finite() && duration > 0.0 {
        entry.duration = duration;
    }
    if opened || entry.opened_at == 0 {
        entry.opened_at = now_ms();
        recent.insert(0, entry);
    } else {
        let i = at.unwrap_or(0).min(recent.len());
        recent.insert(i, entry);
    }
    recent.truncate(RECENT_MAX);
    files.save(&recent);
    Ok(())
}

/// Take `path` off Recent files, or every file without one.
#[tauri::command]
pub fn local_forget(files: State<'_, Arc<LocalFiles>>, path: Option<String>) {
    let mut recent = files.recent.locked();
    match path {
        Some(p) => recent.retain(|r| r.path != p),
        None => recent.clear(),
    }
    files.save(&recent);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn episodes_sort_by_number() {
        let mut names = vec!["Show 10.mkv", "show 2.mkv", "Show 1.mkv", "Show 01b.mkv"];
        names.sort_by(|a, b| natural_cmp(a, b));
        assert_eq!(names, ["Show 1.mkv", "Show 01b.mkv", "show 2.mkv", "Show 10.mkv"]);
    }

    #[test]
    fn only_videos_are_granted() {
        let dir = std::env::temp_dir().join(format!("polar-local-{}", now_ms()));
        std::fs::create_dir_all(&dir).unwrap();
        for f in ["b 2.mkv", "b 10.MP4", "notes.txt"] {
            std::fs::write(dir.join(f), b"x").unwrap();
        }
        let files = LocalFiles::load(dir.join("recent.json"));
        let got = files.grant([dir.clone(), dir.join("notes.txt"), PathBuf::from("relative.mkv")]);
        let names: Vec<_> = got.iter().map(|f| f.name.as_str()).collect();
        assert_eq!(names, ["b 2.mkv", "b 10.MP4"]);
        assert!(files.owns(&got[0].path));
        assert!(!files.owns(&dir.join("notes.txt").to_string_lossy()));
        std::fs::remove_dir_all(dir).ok();
    }
}
