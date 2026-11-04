//! The Stremio addon protocol, so every existing catalog/meta/stream addon
//! works with polar unchanged.
//!
//! * [`types`] — canonical shapes the app works with.
//! * [`client`] — fetches remote addons and normalises their (loose) JSON.
//! * [`probe`] — checks a stream link before the player opens it, step by step.
//! * [`rank`] — parses stream titles into structured quality info and scores them,
//!   so the player can pick the best source without the user reading 40 rows.

pub mod client;
pub mod probe;
pub mod rank;
pub mod subs;
pub mod types;

pub use client::{AddonClient, AddonError};
pub use rank::{rank_streams, rank_streams_filtered, RankedStream, StreamFilter, StreamQuality};
pub use types::*;
