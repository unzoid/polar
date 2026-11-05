//! Anime data the app fetches itself rather than from an addon, with what it
//! keeps of it on disk. Tauri-free, so it is tested here; `src-tauri` gives it
//! a cache folder and exposes it as commands.
//!
//! - [`fillers`]: which episodes are filler or recap (Jikan, then
//!   animefillerlist.com), cached for a day in one JSON file.
//! - [`anime_lists`]: Fribb/anime-lists, the anime id mapping used when
//!   ani.zip is down, downloaded when first needed and kept for a week.

pub mod anime_lists;
pub mod fillers;

pub use anime_lists::{AnimeKey, AnimeLists, AnimeMapping};
pub use fillers::{EpisodeFlags, Fillers, Source};
