//! What a profile owns and how it changes: the library, watch progress and
//! anime links of one space, the operations the app performs on them, and
//! the local half of account sync. No I/O and no Tauri, so all of it is
//! tested here; `src-tauri` keeps the file and the commands.
//!
//! - [`identity`]: canonical title ids and aliases (one show, one item).
//! - [`space`]: library, progress, Continue Watching, history, re-keying.
//! - [`sync`]: changes since the last push, and merging pulled ones.
//! - [`opened`]: what to make of a data file read at start-up (missing, unreadable, corrupt).

#[cfg(test)]
mod contract;
pub mod identity;
pub mod opened;
pub mod space;
pub mod sync;

pub use identity::{Aliases, AnimeLink};
pub use space::{LibraryItem, Progress, Space};
pub use sync::{Changes, SyncLibraryItem};
