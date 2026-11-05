//! The app's log file (critique M14): `polar.log` in the app's log folder,
//! moved to `polar.log.1` when it passes a size, so the two never hold more
//! than about twice that. `src-tauri/src/logging.rs` hands it to `tracing`.
//!
//! What goes in is what the app writes there: hosts and plain reasons, never
//! keys, add-on links or titles. A file that can't be opened or written is
//! skipped quietly: logging must never stop the app.

use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

/// A log file that starts over (keeping one old copy) past `max` bytes.
/// Cheap to clone; every clone writes to the same file.
#[derive(Clone)]
pub struct LogFile(Arc<Mutex<Inner>>);

struct Inner {
    path: PathBuf,
    max: u64,
    open: Option<(File, u64)>,
}

impl LogFile {
    pub fn new(path: impl Into<PathBuf>, max: u64) -> Self {
        LogFile(Arc::new(Mutex::new(Inner { path: path.into(), max, open: None })))
    }

    /// The older half, `<name>.1`.
    pub fn previous(path: &Path) -> PathBuf {
        let mut name = path.file_name().unwrap_or_default().to_owned();
        name.push(".1");
        path.with_file_name(name)
    }
}

impl Inner {
    fn file(&mut self, adding: u64) -> io::Result<&mut File> {
        let full = matches!(&self.open, Some((_, size)) if *size > 0 && size + adding > self.max);
        if full {
            self.open = None;
            fs::rename(&self.path, LogFile::previous(&self.path))?;
        }
        if self.open.is_none() {
            if let Some(dir) = self.path.parent() {
                fs::create_dir_all(dir)?;
            }
            let file = OpenOptions::new().create(true).append(true).open(&self.path)?;
            let size = file.metadata()?.len();
            self.open = Some((file, size));
            if size > 0 && size + adding > self.max {
                return self.file(adding);
            }
        }
        let (file, size) = self.open.as_mut().expect("opened above");
        *size += adding;
        Ok(file)
    }
}

impl Write for LogFile {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let mut inner = self.0.lock().unwrap_or_else(|p| p.into_inner());
        match inner.file(buf.len() as u64).and_then(|f| f.write_all(buf)) {
            Ok(()) => {}
            // Try a fresh handle next time (the folder may have been removed).
            Err(_) => inner.open = None,
        }
        Ok(buf.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        let mut inner = self.0.lock().unwrap_or_else(|p| p.into_inner());
        if let Some((file, _)) = inner.open.as_mut() {
            let _ = file.flush();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("polar-logfile-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn appends_and_starts_over_past_the_limit() {
        let d = dir("rotate");
        let path = d.join("logs").join("polar.log");
        let mut log = LogFile::new(&path, 20);
        log.write_all(b"0123456789\n").unwrap();
        log.write_all(b"abcdefgh\n").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "0123456789\nabcdefgh\n");
        log.write_all(b"next\n").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "next\n");
        assert_eq!(fs::read_to_string(LogFile::previous(&path)).unwrap(), "0123456789\nabcdefgh\n");
        log.write_all(b"0123456789abcdef\n").unwrap();
        assert_eq!(fs::read_to_string(LogFile::previous(&path)).unwrap(), "next\n");
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn a_full_file_from_last_time_is_moved_aside_first() {
        let d = dir("reopen");
        let path = d.join("polar.log");
        fs::create_dir_all(&d).unwrap();
        fs::write(&path, "x".repeat(30)).unwrap();
        let mut log = LogFile::new(&path, 20);
        log.clone().write_all(b"hello\n").unwrap();
        log.flush().unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "hello\n");
        assert_eq!(fs::read_to_string(LogFile::previous(&path)).unwrap().len(), 30);
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn a_line_longer_than_the_limit_still_goes_in() {
        let d = dir("long");
        let path = d.join("polar.log");
        let mut log = LogFile::new(&path, 4);
        log.write_all(b"longer than four\n").unwrap();
        assert_eq!(fs::read_to_string(&path).unwrap(), "longer than four\n");
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn a_folder_it_cant_make_is_no_error() {
        let d = dir("blocked");
        fs::create_dir_all(&d).unwrap();
        fs::write(d.join("file"), "").unwrap();
        let mut log = LogFile::new(d.join("file").join("polar.log"), 100);
        log.write_all(b"lost\n").unwrap();
        fs::remove_dir_all(&d).unwrap();
    }
}
