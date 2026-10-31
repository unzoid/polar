//! The Stremio addon protocol, so every existing catalog/meta/stream addon
//! works with rustio unchanged.
//!
//! * [`types`] — canonical shapes the app works with.
//! * [`client`] — fetches remote addons and normalises their (loose) JSON.
//! * [`rank`] — parses stream titles into structured quality info and scores them,
//!   so the player can pick the best source without the user reading 40 rows.

pub mod client;
pub mod rank;
pub mod subs;
pub mod types;

pub use client::{AddonClient, AddonError};
pub use rank::{rank_streams, RankedStream, StreamQuality};
pub use types::*;
