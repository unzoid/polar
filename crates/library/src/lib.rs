//! What a profile owns and how it changes: the library, watch progress and
//! anime links of one space, the operations the app performs on them, and
//! the local half of account sync. No Tauri, and no I/O outside [`saver`] and [`logfile`], so
//! all of it is tested here; `src-tauri` keeps the file and the commands.
//!
//! - [`identity`]: canonical title ids and aliases (one show, one item).
//! - [`space`]: library, progress, Continue Watching, history, re-keying.
//! - [`sync`]: changes since the last push, and merging pulled ones.
//! - [`display`]: names and pictures filled in for pulled titles.
//! - [`opened`]: what to make of a data file read at start-up (missing, unreadable, corrupt).
//! - [`saver`]: writing a data file in the background, all or nothing.
//! - [`logfile`]: the app's log file, kept to a size.
//! - [`keychain`]: how a secret of any size is laid out in the system's keychain.
//! - [`vault`]: API keys and add-on links kept in the keychain instead of the data file.

#[cfg(test)]
mod contract;
pub mod display;
pub mod filenames;
pub mod identity;
pub mod keychain;
pub mod logfile;
pub mod moved;
pub mod opened;
pub mod saver;
pub mod space;
pub mod sync;
pub mod vault;

pub use display::{Display, Untitled};
pub use identity::{Aliases, AnimeLink};
pub use space::{Dirty, LibraryItem, Progress, Space};
pub use sync::{Changes, Pushed, SyncLibraryItem};
