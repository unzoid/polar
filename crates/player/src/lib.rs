//! The player's rules, kept apart from the engines that play (mpv in
//! src-tauri's `player/`, the webview's `<video>`) so they build and are
//! tested on every platform:
//!
//!   * [`allow`]: the only mpv commands and properties the webview may use.
//!   * [`tune`]: device-level picture and sound options as mpv settings.
//!   * [`crop`]: which black bars to remove and the zoom that removes them.
//!   * [`bars`]: our own per-frame bar detector, for builds without `cropdetect`.
//!   * [`motion`]: eased crop moves (ease-out, spring, ease-in-out).
//!   * [`headers`]: which of an add-on's request headers playback sends.
//!   * [`passthrough`]: the ranges and paths of the shell's `trailer` protocol.

pub mod allow;
pub mod bars;
pub mod crop;
pub mod headers;
pub mod motion;
pub mod passthrough;
pub mod tune;
