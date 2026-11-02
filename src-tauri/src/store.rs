//! Everything the user owns — settings, installed addons, library, watch
//! progress — in one JSON file in the app data dir. Small, human-readable,
//! trivially backed up. Swap for SQLite once sync lands.

use std::collections::HashMap;
use std::path::PathBuf;

use polar_addon::Manifest;
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
    /// Show an IMDb rating badge under each poster.
    pub show_card_ratings: bool,
    /// How a season's episodes are laid out: "row" (horizontal shelf) or "list".
    pub episode_layout: String,
    /// Interface font: "inter" (bundled) or "system" (Segoe UI Variable on Windows).
    pub ui_font: String,
    /// How subtitles look in the player.
    pub subtitle_style: SubtitleStyle,

    // --- Playback ---
    /// Seconds the "Up next" countdown runs before the next episode starts.
    pub autoplay_countdown: u32,
    /// After this many episodes autoplay in a row with nobody touching
    /// anything, stop and ask. 0 = never ask.
    pub still_watching_after: u32,
    /// When "Up next" appears: "credits" (as the credits start) or "end".
    pub next_up_timing: String,
    /// Skip recaps on their own. `None` = follow `auto_skip` (older settings).
    pub auto_skip_recaps: Option<bool>,
    /// Pick up where you left off. Off: always start from the beginning.
    pub resume_playback: bool,
    /// Seconds to back up when resuming, to catch the thread again.
    pub resume_rewind: u32,
    /// Percent of a video watched before it counts as watched.
    pub watched_threshold: u32,
    /// Go fullscreen when playback starts.
    pub start_fullscreen: bool,
    /// The timeline's clock: "remaining", "elapsed" or "endsAt".
    pub time_display: String,
    /// Seconds without movement before the player controls hide.
    pub controls_hide_secs: u32,
    /// Mouse wheel over the video: "volume", "seek" or "none".
    pub wheel_action: String,
    /// Clicking the video: "toggle" (play/pause) or "controls" (show them).
    pub click_action: String,
    /// Keep the last playback speed for the next video.
    pub remember_speed: bool,
    pub playback_speed: f32,

    // --- Sources ---
    /// Highest resolution to play (e.g. 1080). 0 = any.
    pub max_resolution: u32,
    /// Largest movie file, GB. 0 = any.
    pub max_movie_size_gb: f32,
    /// Largest episode file, GB. 0 = any.
    pub max_episode_size_gb: f32,
    /// Hide CAM and telesync rips from the source list.
    pub hide_cam: bool,
    /// Comma-separated words; sources mentioning any are hidden.
    pub exclude_keywords: String,
    /// How the source list is sorted when it opens.
    pub source_sort: String,

    // --- Subtitles ---
    /// "always": use the preferred subtitle language whenever there is one.
    /// "foreign": only when the audio isn't already in that language.
    pub subtitle_mode: String,

    // --- Appearance & browsing ---
    /// Accent colour, `#RRGGBB`.
    pub accent_color: String,
    /// "dark" or "black" (pure black backgrounds, for OLED screens).
    pub theme: String,
    /// Poster and thumbnail size: "small", "medium" or "large".
    pub card_size: String,
    /// "system" (follow Windows), "on" or "off".
    pub reduce_motion: String,
    /// Rotate the featured carousel on Home.
    pub hero_autoplay: bool,
    pub show_continue_watching: bool,
    /// Blur the stills of episodes you haven't watched.
    pub hide_episode_thumbs: bool,
    /// Hide the descriptions of episodes you haven't watched.
    pub hide_episode_descriptions: bool,
    /// Where the app opens: "home", "library", "movies" or "series".
    pub start_page: String,
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
    /// Font family name, as installed on the system.
    pub font: String,
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
            font: "Segoe UI Semibold".into(),
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
            show_card_ratings: false,
            episode_layout: "row".into(),
            ui_font: "inter".into(),
            subtitle_style: SubtitleStyle::default(),
            autoplay_countdown: 8,
            still_watching_after: 0,
            next_up_timing: "credits".into(),
            auto_skip_recaps: None,
            resume_playback: true,
            resume_rewind: 0,
            watched_threshold: 92,
            start_fullscreen: false,
            time_display: "remaining".into(),
            controls_hide_secs: 2,
            wheel_action: "volume".into(),
            click_action: "toggle".into(),
            remember_speed: false,
            playback_speed: 1.0,
            max_resolution: 0,
            max_movie_size_gb: 0.0,
            max_episode_size_gb: 0.0,
            hide_cam: true,
            exclude_keywords: String::new(),
            source_sort: "best".into(),
            subtitle_mode: "always".into(),
            accent_color: "#0A84FF".into(),
            theme: "dark".into(),
            card_size: "medium".into(),
            reduce_motion: "system".into(),
            hero_autoplay: true,
            show_continue_watching: true,
            hide_episode_thumbs: false,
            hide_episode_descriptions: false,
            start_page: "home".into(),
        }
    }
}

impl Settings {
    /// Watched threshold as a fraction, kept to a sensible range.
    pub fn watched_fraction(&self) -> f64 {
        (self.watched_threshold.clamp(50, 100) as f64) / 100.0
    }

    /// Source filters for one kind of title.
    pub fn stream_filter(&self, ty: &str) -> polar_addon::StreamFilter {
        let gb = if ty == "movie" { self.max_movie_size_gb } else { self.max_episode_size_gb };
        polar_addon::StreamFilter {
            max_resolution: (self.max_resolution > 0).then(|| self.max_resolution.min(u16::MAX as u32) as u16),
            max_size_bytes: (gb > 0.0).then(|| (gb as f64 * 1e9) as u64),
            hide_cam: self.hide_cam,
            exclude_words: self
                .exclude_keywords
                .split(',')
                .map(|w| w.trim().to_owned())
                .filter(|w| !w.is_empty())
                .collect(),
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
    pub stream: Option<polar_addon::Stream>,
    /// Seconds.
    pub position: f64,
    pub duration: f64,
    pub updated_at: u64,
}

impl Progress {
    pub fn fraction(&self) -> f64 {
        if self.duration > 0.0 { (self.position / self.duration).clamp(0.0, 1.0) } else { 0.0 }
    }

    /// Past the watched threshold (Settings → Playback), e.g. 0.92.
    pub fn finished(&self, threshold: f64) -> bool {
        self.fraction() >= threshold
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
    /// Bundled addons already installed once (manifest URLs). Removing one
    /// keeps it here, so it isn't put back on the next launch.
    pub bundled_addons: Vec<String>,
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
        let mut data: Data = match std::fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_else(|e| {
                // Starting fresh would overwrite the user's library, history,
                // addons and settings on the next save. Keep the unreadable
                // file next to it so nothing is lost for good.
                let backup = path.with_extension(format!("corrupt-{}.json", now()));
                eprintln!("polar: {} is unreadable ({e}); kept as {}", path.display(), backup.display());
                let _ = std::fs::copy(&path, backup);
                Data::default()
            }),
            Err(_) => Data::default(),
        };
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
