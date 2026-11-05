//! A data file that moved to another folder between versions (the downloads list: from roaming
//! to local app data, test report 1 item 29).
//!
//! [`take_over`] copies the old file to its new place once, then renames the old one to
//! `<name>.moved` so nothing is left that looks current but is read by nobody (re-test 2). The
//! rename comes only after the new copy exists; a copy that fails leaves the old file as it was.

use std::io;
use std::path::{Path, PathBuf};

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
        if let Some(dir) = new.parent() {
            std::fs::create_dir_all(dir)?;
        }
        std::fs::copy(old, new)?;
        TakeOver::Moved
    };
    std::fs::rename(old, retired_name(old))?;
    Ok(done)
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
    fn the_same_path_is_nothing_to_do() {
        let dir = scratch("same");
        let old = dir.join("old/downloads.json");
        std::fs::write(&old, b"[1]").unwrap();
        assert_eq!(take_over(&old, &old).unwrap(), TakeOver::Nothing);
        assert!(old.exists());
    }
}
