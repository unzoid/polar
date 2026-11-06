//! Torrent playback for streams the user's own add-ons return (an info hash
//! and a file index): a built-in engine, so they play with nothing else
//! installed. The chosen file is fetched in playback order and served to the
//! player over a loopback link that supports seeking.

mod engine;
pub mod magnet;
pub mod serve;

pub use engine::{Engine, Limits, OnStep, Opened, Options, Request, Step};
