//! Everything the user owns — settings, installed addons, and one space
//! (library, watch progress, anime links; see `polar_library`) per profile —
//! in one JSON file in the app data dir. Small, readable, trivially backed
//! up. Commands change it in memory; `polar_library::saver` writes it a
//! moment later off the UI thread (`AppState::persist`), and on exit. API keys and add-on links
//! go into the system's keychain instead where there is one (`polar_library::vault`, #195).

use std::collections::HashMap;
use std::path::PathBuf;

use polar_addon::Manifest;
use polar_library::opened::{self, Opened};
use polar_library::vault::{self, Secrets};
pub use polar_library::{LibraryItem, Progress, Space};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub tmdb_key: Option<String>,
    pub language: String,
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
    /// Tint IMDb scores by band (green / amber / red). Off: always IMDb yellow.
    pub rating_colors: bool,
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
    /// Tag filters (e.g. "dv", "hdr", "remux") the source list turns on by
    /// itself whenever some source has that tag.
    pub source_auto_tags: Vec<String>,
    /// Rank sources sharper than this screen below ones that match it.
    pub prefer_screen_resolution: bool,
    /// Source filters hide what doesn't match; off, matches go first and the
    /// rest stays below them.
    pub source_filters_hide: bool,

    // --- Services ---
    /// MDBList (mdblist.com) key: Rotten Tomatoes, Metacritic, Letterboxd and Trakt scores.
    pub mdblist_key: Option<String>,
    /// OMDb (omdbapi.com) key: Rotten Tomatoes and Metacritic scores.
    pub omdb_key: Option<String>,

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
    /// Play a title's trailer behind its page after a few seconds there.
    pub trailer_autoplay: bool,
    /// Those trailers start with sound.
    pub trailer_sound: bool,
    /// Where a card's IMDb rating sits: "poster" (on the art) or "below" it.
    pub card_rating_position: String,
    /// The Calendar section: upcoming episodes of your shows. Opt-in.
    pub show_calendar: bool,
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
            rating_colors: false,
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
            source_auto_tags: Vec::new(),
            prefer_screen_resolution: true,
            source_filters_hide: false,
            mdblist_key: None,
            omdb_key: None,
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
            trailer_autoplay: true,
            trailer_sound: false,
            card_rating_position: "poster".into(),
            show_calendar: false,
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
            max_size_bytes: (gb > 0.0).then_some((gb as f64 * 1e9) as u64),
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

/// The space used when nobody is signed in.
pub const LOCAL_SPACE: &str = "local";

/// Layout of `polarity.json`, bumped when a change needs old files read
/// differently. 0 = files from before the field existed.
pub const VERSION: u32 = 1;

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Data {
    /// [`VERSION`] of the build that last wrote the file.
    pub version: u32,
    pub settings: Settings,
    pub addons: Vec<InstalledAddon>,
    /// Bundled addons already installed once (manifest URLs). Removing one
    /// keeps it here, so it isn't put back on the next launch.
    pub bundled_addons: Vec<String>,
    pub spaces: HashMap<String, Space>,
    /// Which space library/progress commands act on.
    pub active_space: String,
    /// API keys and add-on links are in the keychain, emptied here (`polar_library::vault`). Set
    /// by the saver; read once at start-up.
    pub secrets_in_keychain: bool,
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

    /// Puts the keychain's secrets where the file left them empty.
    pub fn fill_secrets(&mut self, from: &Secrets) {
        let settings = &mut self.settings;
        for (field, key) in [
            ("tmdbKey", &mut settings.tmdb_key),
            ("seekrKey", &mut settings.seekr_key),
            ("mdblistKey", &mut settings.mdblist_key),
            ("omdbKey", &mut settings.omdb_key),
        ] {
            if key.as_deref().unwrap_or("").is_empty() {
                if let Some(stored) = from.key(field) {
                    *key = Some(stored.into());
                }
            }
        }
        let slots = vault::slots(self.addons.iter().map(|a| a.manifest.id.as_str()));
        for (addon, slot) in self.addons.iter_mut().zip(slots) {
            if addon.manifest_url.is_empty() {
                if let Some(url) = from.addon(&slot) {
                    addon.manifest_url = url.into();
                }
            }
        }
    }

    pub(crate) fn migrate(&mut self) {
        self.version = VERSION;
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
    /// Why the file couldn't be read at start-up: while set, nothing is saved
    /// over it (critique C1) and the app says so (`store_problem`).
    problem: Option<String>,
}

impl Store {
    pub fn load(path: PathBuf) -> Self {
        let (mut data, problem) = match opened::open::<Data>(std::fs::read(&path)) {
            Opened::Data(data) if data.version > VERSION => {
                // A newer Polarity wrote this: what this build doesn't know
                // would be dropped on the next save, so keep its file aside.
                let backup = path.with_extension(format!("v{}-{}.json", data.version, now()));
                tracing::warn!("{} is from a newer version; keeping it as {}", path.display(), backup.display());
                match std::fs::copy(&path, &backup) {
                    Ok(_) => (data, None),
                    Err(copy) => (
                        data,
                        Some(format!("{} is from a newer Polarity and couldn't be backed up ({copy})", path.display())),
                    ),
                }
            }
            Opened::Data(data) => (data, None),
            Opened::Fresh => (Data::default(), None),
            Opened::Corrupt(e) => {
                // Starting fresh overwrites the library, history, addons and
                // settings on the next save, so the unreadable file is kept
                // next to it first; without that copy nothing is saved.
                let backup = path.with_extension(format!("corrupt-{}.json", now()));
                tracing::error!("{} is unreadable ({e}); keeping it as {}", path.display(), backup.display());
                match std::fs::copy(&path, &backup) {
                    Ok(_) => (Data::default(), None),
                    Err(copy) => (
                        Data::default(),
                        Some(format!("{} is damaged and couldn't be backed up ({copy})", path.display())),
                    ),
                }
            }
            Opened::Unreadable(e) => {
                tracing::error!("can't read {} ({e}); not saving over it", path.display());
                (Data::default(), Some(format!("{} couldn't be read ({e})", path.display())))
            }
        };
        data.migrate();
        Self { path, data, problem }
    }

    /// Set when the file couldn't be read at start-up: changes this session aren't saved.
    pub fn problem(&self) -> Option<&str> {
        self.problem.as_deref()
    }

    /// Where the file lives.
    pub fn path(&self) -> &std::path::Path {
        &self.path
    }

    /// The file's contents as they should be now, secrets still in: the saver hands them to
    /// the keychain outside the lock, then writes it compact (the file is rewritten whole, and
    /// indenting only made that bigger).
    pub fn snapshot(&self) -> Result<serde_json::Value, String> {
        if let Some(problem) = &self.problem {
            return Err(format!("not saved: {problem}"));
        }
        serde_json::to_value(&self.data).map_err(|e| e.to_string())
    }
}

pub fn now() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or_default()
}
