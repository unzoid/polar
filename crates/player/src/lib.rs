//! The player's rules, kept apart from the engines that play (mpv in
//! src-tauri's `player.rs`, the webview's `<video>`) so they build and are
//! tested on every platform:
//!
//!   * [`allow`]: the only mpv commands and properties the webview may use.
//!   * [`tune`]: device-level picture and sound options as mpv settings.
//!   * [`crop`]: which black bars to remove and the zoom that removes them.

pub mod allow;
pub mod crop;
pub mod tune;
