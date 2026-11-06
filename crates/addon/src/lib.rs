//! The Stremio addon protocol, so every existing catalog/meta/stream addon
//! works with polar unchanged.
//!
//! * [`types`] — canonical shapes the app works with.
//! * [`client`] — fetches remote addons and normalises their (loose) JSON.
//! * [`numbering`] — TMDB episodes renumbered onto IMDb's, by air date.
//! * [`probe`] — checks a stream link before the player opens it, step by step.
//! * [`episode`] — which episode a stream's file is, checked against the one asked for.
//! * [`rank`] — parses stream titles into structured quality info and scores them,
//!   so the player can pick the best source without the user reading 40 rows.

pub mod client;
#[cfg(test)]
mod contract;
pub mod episode;
pub mod numbering;
pub mod offered;
pub mod probe;
pub mod rank;
pub mod subs;
pub mod types;

pub use client::{AddonClient, AddonError};
pub use episode::WantedEpisode;
pub use rank::{rank_asked, rank_streams, rank_streams_filtered, Asked, RankedStream, StreamFilter, StreamQuality};
pub use types::*;
