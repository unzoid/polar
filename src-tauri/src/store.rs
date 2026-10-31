//! Everything the user owns — settings, installed addons, library, watch
//! progress — in one JSON file in the app data dir. Small, human-readable,
//! trivially backed up. Swap for SQLite once sync lands.

use std::collections::HashMap;
use std::path::PathBuf;

use rustio_addon::Manifest;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub tmdb_key: Option<String>,
    pub language: String,
    /// A Stremio-compatible bridge that turns p2ps into HTTP
    /// (`{server}/{content_id}/{fileIdx}`). Bridge until the built-in engine lands.
    pub bridge: String,
    /// Auto-play the next episode when one ends.
    pub autoplay_next: bool,
    /// Seekr (seekr.tv) API key for seek-bar thumbnails. Optional feature.
    pub seekr_key: Option<String>,
    /// Show seek-bar thumbnails when a Seekr key is set.
    pub seek_previews: bool,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            tmdb_key: None,
            language: "en-US".into(),
            bridge: "http://127.0.0.1:11470".into(),
            autoplay_next: true,
            seekr_key: None,
            seek_previews: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledAddon {
    pub manifest_url: String,
    pub manifest: Manifest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    pub id: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub name: String,
    pub poster: Option<String>,
    pub added_at: u64,
}

/// Progress for one playable video (a movie id, or `tt…:s:e`).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub meta_id: String,
    pub video_id: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub name: String,
    pub background: Option<String>,
    pub poster: Option<String>,
    pub season: Option<u32>,
    pub episode: Option<u32>,
    pub episode_title: Option<String>,
    /// The source that was playing, so resume uses the same file (and timings).
    #[serde(default)]
    pub stream: Option<rustio_addon::Stream>,
    /// Seconds.
    pub position: f64,
    pub duration: f64,
    pub updated_at: u64,
}

impl Progress {
    pub fn fraction(&self) -> f64 {
        if self.duration > 0.0 { (self.position / self.duration).clamp(0.0, 1.0) } else { 0.0 }
    }

    /// Past the credits threshold — counts as watched.
    pub fn finished(&self) -> bool {
        self.fraction() >= 0.92
    }
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Data {
    pub settings: Settings,
    pub addons: Vec<InstalledAddon>,
    pub library: HashMap<String, LibraryItem>,
    pub progress: HashMap<String, Progress>,
}

pub struct Store {
    path: PathBuf,
    pub data: Data,
}

impl Store {
    pub fn load(path: PathBuf) -> Self {
        let data = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        Self { path, data }
    }

    /// Write via a temp file + rename so a crash never leaves half a file.
    pub fn save(&self) -> std::io::Result<()> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, serde_json::to_vec_pretty(&self.data)?)?;
        std::fs::rename(tmp, &self.path)
    }
}

pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or_default()
}
