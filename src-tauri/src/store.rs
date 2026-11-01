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
    /// Skip intros and recaps without asking (IntroDB timings).
    pub auto_skip: bool,
    /// Preferred audio language, e.g. `en`. Empty = whatever the file defaults to.
    pub audio_language: String,
    /// Preferred subtitle language, e.g. `en`. Empty = subtitles off.
    pub subtitle_language: String,
    /// Seconds the arrow keys (and skip buttons) jump.
    pub seek_step: u32,
    /// Play the best source straight away. Off: Play opens the source list first.
    pub auto_pick_source: bool,
    /// Show the title under each poster and thumbnail.
    pub show_card_titles: bool,
    /// Show the type, genre and year under those titles.
    pub show_card_details: bool,
    /// How a season's episodes are laid out: "row" (horizontal shelf) or "list".
    pub episode_layout: String,
    /// Interface font: "inter" (bundled) or "system" (Segoe UI Variable on Windows).
    pub ui_font: String,
    /// How subtitles look in the player.
    pub subtitle_style: SubtitleStyle,
}

/// Subtitle appearance. Applies to every video; the timing offset (delay) is
/// per video, so it isn't stored here.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SubtitleStyle {
    /// Text size, percent of normal.
    pub size: u32,
    /// How far above the usual spot the text sits, percent of the picture height.
    pub raise: u32,
    /// Text colour, `#RRGGBB`.
    pub color: String,
    /// Text opacity, percent.
    pub opacity: u32,
    /// "none" | "thin" | "medium" | "thick".
    pub outline: String,
    /// Outline colour, `#RRGGBB`.
    pub outline_color: String,
    /// Opacity of a dark box behind the text, percent (0 = no box).
    pub background: u32,
}

impl Default for SubtitleStyle {
    fn default() -> Self {
        Self {
            size: 100,
            raise: 0,
            color: "#FFFFFF".into(),
            opacity: 100,
            outline: "thin".into(),
            outline_color: "#000000".into(),
            background: 0,
        }
    }
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
            auto_skip: false,
            audio_language: String::new(),
            subtitle_language: String::new(),
            seek_step: 10,
            auto_pick_source: true,
            show_card_titles: true,
            show_card_details: true,
            episode_layout: "row".into(),
            ui_font: "inter".into(),
            subtitle_style: SubtitleStyle::default(),
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

/// The space used when nobody is signed in.
pub const LOCAL_SPACE: &str = "local";

/// One person's library and watch history: the signed-out "local" space, or
/// one per account profile (keyed by profile id). Each is a full offline
/// copy; sync only moves changes between it and the server.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Space {
    pub library: HashMap<String, LibraryItem>,
    /// Removed library items → when (ms), so removals sync too.
    pub removed: HashMap<String, u64>,
    pub progress: HashMap<String, Progress>,
    /// Local clock (ms) of the last successful push.
    pub pushed_at: u64,
    /// Server cursor of the last pull (opaque to Rust).
    pub pulled_at: Option<String>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Data {
    pub settings: Settings,
    pub addons: Vec<InstalledAddon>,
    pub spaces: HashMap<String, Space>,
    /// Which space library/progress commands act on.
    pub active_space: String,
    // Pre-profiles layout; moved into the local space on load.
    #[serde(skip_serializing)]
    library: HashMap<String, LibraryItem>,
    #[serde(skip_serializing)]
    progress: HashMap<String, Progress>,
}

impl Data {
    pub fn space(&self) -> Option<&Space> {
        self.spaces.get(&self.active_space)
    }

    pub fn space_mut(&mut self) -> &mut Space {
        self.spaces.entry(self.active_space.clone()).or_default()
    }

    pub(crate) fn migrate(&mut self) {
        if self.active_space.is_empty() {
            self.active_space = LOCAL_SPACE.into();
        }
        if !self.library.is_empty() || !self.progress.is_empty() {
            let local = self.spaces.entry(LOCAL_SPACE.into()).or_default();
            local.library.extend(std::mem::take(&mut self.library));
            local.progress.extend(std::mem::take(&mut self.progress));
        }
    }
}

pub struct Store {
    path: PathBuf,
    pub data: Data,
}

impl Store {
    pub fn load(path: PathBuf) -> Self {
        let mut data: Data = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        data.migrate();
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
