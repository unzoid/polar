//! What to make of a data file read at start-up (`polarity.json`, `downloads.json`).
//!
//! Only a file that isn't there means "start fresh". Any other read error (a
//! file locked by antivirus or a sync tool, a permission change, a disk error)
//! says nothing about what the file holds, so the app must not write over it:
//! it starts read-only and says so (critique C1). A file that reads but doesn't
//! parse is copied aside before the app starts fresh. The I/O stays with the
//! caller; this decides.

use std::io::{self, ErrorKind};

use serde::de::DeserializeOwned;

#[derive(Debug)]
pub enum Opened<T> {
    /// No file yet: start empty and save as usual.
    Fresh,
    /// The file's contents.
    Data(T),
    /// The file reads but isn't valid: keep a copy of it, then start empty.
    Corrupt(String),
    /// The file couldn't be read: start empty and never save over it.
    Unreadable(String),
}

/// Decides from the result of reading the file.
pub fn open<T: DeserializeOwned>(read: io::Result<Vec<u8>>) -> Opened<T> {
    match read {
        Ok(bytes) => match serde_json::from_slice(&bytes) {
            Ok(data) => Opened::Data(data),
            Err(e) => Opened::Corrupt(e.to_string()),
        },
        Err(e) if e.kind() == ErrorKind::NotFound => Opened::Fresh,
        Err(e) => Opened::Unreadable(e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;

    type Doc = BTreeMap<String, u32>;

    #[test]
    fn missing_file_starts_fresh() {
        assert!(matches!(open::<Doc>(Err(ErrorKind::NotFound.into())), Opened::Fresh));
    }

    #[test]
    fn any_other_read_error_is_unreadable_not_fresh() {
        for kind in [ErrorKind::PermissionDenied, ErrorKind::Interrupted, ErrorKind::Other, ErrorKind::IsADirectory] {
            assert!(matches!(open::<Doc>(Err(kind.into())), Opened::Unreadable(_)), "{kind:?}");
        }
    }

    #[test]
    fn a_directory_in_its_place_is_unreadable() {
        // A directory named like the data file, read without a trailing separator: on
        // Windows `temp_dir()` ends in `\`, and reading `D:\TEMP\` is NotFound, while the
        // real case (`...\polar.json` a directory) is PermissionDenied.
        let dir = std::env::temp_dir().join(format!("polar-opened-{}", std::process::id())).join("polar.json");
        std::fs::create_dir_all(&dir).unwrap();
        let read = std::fs::read(&dir);
        std::fs::remove_dir_all(dir.parent().unwrap()).ok();
        assert!(matches!(open::<Doc>(read), Opened::Unreadable(_)));
    }

    #[test]
    fn bad_json_is_corrupt_and_good_json_is_data() {
        assert!(matches!(open::<Doc>(Ok(b"{\"a\": ".to_vec())), Opened::Corrupt(_)));
        match open::<Doc>(Ok(b"{\"a\": 1}".to_vec())) {
            Opened::Data(d) => assert_eq!(d["a"], 1),
            other => panic!("{other:?}"),
        }
    }
}
