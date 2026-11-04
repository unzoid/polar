//! Anime data the app fetches itself rather than from an addon, with what it
//! keeps of it on disk. Tauri-free, so it is tested here; `src-tauri` gives it
//! a cache folder and exposes it as commands.
//!
//! - [`fillers`]: which episodes are filler or recap (Jikan, then
//!   animefillerlist.com), cached for a day in one JSON file.

pub mod fillers;

pub use fillers::{EpisodeFlags, Fillers, Source};
