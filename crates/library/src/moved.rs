//! A data file that moved between versions: the downloads list from roaming to local app data
//! (test report 1 item 29), `polar.json` renamed `polarity.json` (#40).
//!
//! [`take_over`] copies the old file to its new place once, then renames the old one to
//! `<name>.moved` so nothing is left that looks current but is read by nobody (re-test 2). The
//! copy is written whole or not at all ([`write_atomic`]), and the rename comes only after it
//! exists; a copy that fails leaves the old file as it was. [`take_over_or_keep`] says which file
//! to read afterwards.

use std::io;
use std::path::{Path, PathBuf};

use crate::saver::write_atomic;

/// What [`take_over`] did.
#[derive(Debug, PartialEq, Eq)]
pub enum TakeOver {
    /// No old file (or it is the new one): nothing to do.
    Nothing,
    /// Copied to the new place, the old one renamed.
    Moved,
    /// The new place already had a list (an earlier version copied it): the old one renamed only.
    Retired,
}

/// The name the old file gets once the new one is in place.
pub fn retired_name(old: &Path) -> PathBuf {
    let mut name = old.file_name().unwrap_or_default().to_os_string();
    name.push(".moved");
    old.with_file_name(name)
}

/// Moves `old` to `new` as described in the module notes.
pub fn take_over(old: &Path, new: &Path) -> io::Result<TakeOver> {
    if old == new || !old.is_file() {
        return Ok(TakeOver::Nothing);
    }
    let done = if new.exists() {
        TakeOver::Retired
    } else {
        write_atomic(new, &std::fs::read(old)?)?;
        TakeOver::Moved
    };
    std::fs::rename(old, retired_name(old))?;
    Ok(done)
}

/// [`take_over`], then the file to read: the new one, unless the takeover failed before it existed
/// (the old file couldn't be read, the disk is full). Then the old one stays in use this time, so
/// the app reads it (or says it can't) rather than starting empty, and the next start tries again.
pub fn take_over_or_keep(old: &Path, new: &Path) -> (PathBuf, io::Result<TakeOver>) {
    let done = take_over(old, new);
    let path = if done.is_err() && !new.is_file() { old } else { new };
    (path.to_path_buf(), done)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("polar-moved-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("old")).unwrap();
        dir
    }

    #[test]
    fn the_list_is_copied_and_the_old_one_renamed() {
        let dir = scratch("copy");
        let (old, new) = (dir.join("old/downloads.json"), dir.join("new/downloads.json"));
        std::fs::write(&old, b"[1]").unwrap();
        assert_eq!(take_over(&old, &new).unwrap(), TakeOver::Moved);
        assert_eq!(std::fs::read(&new).unwrap(), b"[1]");
        assert!(!old.exists());
        assert_eq!(std::fs::read(dir.join("old/downloads.json.moved")).unwrap(), b"[1]");
        assert_eq!(take_over(&old, &new).unwrap(), TakeOver::Nothing);
    }

    #[test]
    fn a_list_already_taken_over_keeps_the_new_one_and_retires_the_old() {
        let dir = scratch("retire");
        let (old, new) = (dir.join("old/downloads.json"), dir.join("new/downloads.json"));
        std::fs::write(&old, b"[old]").unwrap();
        std::fs::create_dir_all(dir.join("new")).unwrap();
        std::fs::write(&new, b"[new]").unwrap();
        assert_eq!(take_over(&old, &new).unwrap(), TakeOver::Retired);
        assert_eq!(std::fs::read(&new).unwrap(), b"[new]");
        assert!(!old.exists() && retired_name(&old).exists());
    }

    #[test]
    fn a_failed_copy_leaves_the_old_list_alone() {
        let dir = scratch("fail");
        let old = dir.join("old/downloads.json");
        std::fs::write(&old, b"[1]").unwrap();
        // The new folder's place is taken by a file, so it can't be created.
        std::fs::write(dir.join("blocked"), b"").unwrap();
        assert!(take_over(&old, &dir.join("blocked/downloads.json")).is_err());
        assert!(old.exists() && !retired_name(&old).exists());
    }

    #[test]
    fn polar_json_becomes_polarity_json_owner_only() {
        let dir = scratch("rename");
        let (old, new) = (dir.join("old/polar.json"), dir.join("old/polarity.json"));
        std::fs::write(&old, b"{\"version\":1}").unwrap();
        let (path, done) = take_over_or_keep(&old, &new);
        assert_eq!((path, done.unwrap()), (new.clone(), TakeOver::Moved));
        assert_eq!(std::fs::read(&new).unwrap(), b"{\"version\":1}");
        assert!(!old.exists() && retired_name(&old).exists());
        #[cfg(unix)]
        assert_eq!(
            std::os::unix::fs::PermissionsExt::mode(&std::fs::metadata(&new).unwrap().permissions()) & 0o777,
            0o600
        );
        // Next start: nothing left to do.
        assert_eq!(take_over_or_keep(&old, &new).1.unwrap(), TakeOver::Nothing);
        // A first start: no file at all, the new name.
        let fresh = dir.join("fresh");
        assert_eq!(
            take_over_or_keep(&fresh.join("polar.json"), &fresh.join("polarity.json")).0,
            fresh.join("polarity.json")
        );
    }

    #[test]
    fn a_failed_takeover_keeps_reading_the_old_file() {
        let dir = scratch("keep");
        let old = dir.join("old/polar.json");
        std::fs::write(&old, b"{}").unwrap();
        std::fs::write(dir.join("blocked"), b"").unwrap();
        let (path, done) = take_over_or_keep(&old, &dir.join("blocked/polarity.json"));
        assert!(done.is_err());
        assert_eq!(path, old);
        assert!(old.exists());
    }

    #[test]
    fn the_same_path_is_nothing_to_do() {
        let dir = scratch("same");
        let old = dir.join("old/downloads.json");
        std::fs::write(&old, b"[1]").unwrap();
        assert_eq!(take_over(&old, &old).unwrap(), TakeOver::Nothing);
        assert!(old.exists());
    }
}
