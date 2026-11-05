//! Writing a data file without holding up whoever changed it (critique H8, M4).
//!
//! Commands change the data in memory and call [`Saver::mark`]; a thread of
//! its own writes the file a moment later, so the player saving progress every
//! few seconds or a burst of sync merges costs one write, off the UI thread.
//! [`Saver::flush`] writes what is pending and waits (app exit). A failed
//! write is kept for [`Saver::error`] until one succeeds, so the next command
//! can still say the change wasn't saved.
//!
//! [`write_atomic`] is how every data file reaches the disk: a temp file,
//! flushed, renamed over the old one, then the folder flushed, so a crash or a
//! power cut leaves either the old file or the new one, never half of one.
//! On Linux and macOS the file is readable by its owner only: it holds API
//! keys and add-on links (no keychain, the owner's choice I-008).

use std::fs;
use std::io::{self, Write};
use std::panic::{self, AssertUnwindSafe};
use std::path::Path;
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

/// Replaces `path` with `bytes`, all or nothing.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir)?;
    }
    let mut name = path.file_name().unwrap_or_default().to_owned();
    name.push(".tmp");
    let tmp = path.with_file_name(name);
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options.open(&tmp)?;
    // `mode` only applies to a new file; a temp left over from a crash keeps its own.
    #[cfg(unix)]
    file.set_permissions(std::os::unix::fs::PermissionsExt::from_mode(0o600))?;
    file.write_all(bytes)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&tmp, path)?;
    // The rename itself is only durable once the folder is. Windows can't
    // open a folder this way and flushes renames on its own.
    #[cfg(unix)]
    if let Some(dir) = path.parent() {
        fs::File::open(dir)?.sync_all()?;
    }
    Ok(())
}

/// Writes in the background, at most once per `delay` however often it is asked.
pub struct Saver {
    shared: Arc<Shared>,
}

struct Shared {
    state: Mutex<State>,
    changed: Condvar,
}

#[derive(Default)]
struct State {
    /// Bumped by every `mark`.
    marked: u64,
    /// The `marked` value the last finished write covered.
    written: u64,
    /// Write without waiting out the delay.
    hurry: bool,
    error: Option<String>,
}

impl Shared {
    fn lock(&self) -> MutexGuard<'_, State> {
        // A panic in `write` happens outside the lock; a poisoned lock still
        // holds plain counters, so keep going.
        self.state.lock().unwrap_or_else(|e| e.into_inner())
    }
}

impl Saver {
    /// Starts the writer thread. `write` reads the current data and writes it
    /// (with [`write_atomic`]); its error is what [`Saver::error`] returns.
    pub fn spawn(delay: Duration, mut write: impl FnMut() -> Result<(), String> + Send + 'static) -> Self {
        let shared = Arc::new(Shared { state: Mutex::default(), changed: Condvar::new() });
        let worker = shared.clone();
        thread::Builder::new()
            .name("polar-saver".into())
            .spawn(move || loop {
                let mut state = worker.lock();
                while state.marked == state.written {
                    state = worker.changed.wait(state).unwrap_or_else(|e| e.into_inner());
                }
                // Gather whatever else changes within the delay into this write.
                let due = Instant::now() + delay;
                while !state.hurry {
                    let left = due.saturating_duration_since(Instant::now());
                    if left.is_zero() {
                        break;
                    }
                    state = worker.changed.wait_timeout(state, left).unwrap_or_else(|e| e.into_inner()).0;
                }
                let covers = state.marked;
                state.hurry = false;
                drop(state);
                // A panicking `write` must not end the thread: nothing would be written again.
                let result = panic::catch_unwind(AssertUnwindSafe(&mut write))
                    .unwrap_or_else(|_| Err("the writer panicked".to_owned()));
                let mut state = worker.lock();
                state.written = covers;
                state.error = result.err();
                worker.changed.notify_all();
            })
            .expect("can't start the saver thread");
        Self { shared }
    }

    /// The data changed: write it soon.
    pub fn mark(&self) {
        self.shared.lock().marked += 1;
        self.shared.changed.notify_all();
    }

    /// The data changed in a way someone chose (a setting, the library): write it
    /// now, without waiting out the delay, so quitting or a crash right after
    /// doesn't lose it. Doesn't wait for the write.
    pub fn mark_now(&self) {
        let mut state = self.shared.lock();
        state.marked += 1;
        state.hurry = true;
        self.shared.changed.notify_all();
    }

    /// Writes what is pending now and waits for it.
    pub fn flush(&self) {
        let mut state = self.shared.lock();
        let target = state.marked;
        if state.written >= target {
            return;
        }
        state.hurry = true;
        self.shared.changed.notify_all();
        while state.written < target {
            state = self.shared.changed.wait(state).unwrap_or_else(|e| e.into_inner());
        }
    }

    /// Why the last write failed, until one succeeds.
    pub fn error(&self) -> Option<String> {
        self.shared.lock().error.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    fn counting(delay: Duration) -> (Saver, Arc<AtomicUsize>) {
        let writes = Arc::new(AtomicUsize::new(0));
        let counter = writes.clone();
        let saver = Saver::spawn(delay, move || {
            counter.fetch_add(1, Ordering::SeqCst);
            Ok(())
        });
        (saver, writes)
    }

    #[test]
    fn many_marks_within_the_delay_are_one_write() {
        let (saver, writes) = counting(Duration::from_millis(200));
        for _ in 0..50 {
            saver.mark();
        }
        saver.flush();
        assert_eq!(writes.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_mark_is_written_after_the_delay_without_a_flush() {
        let (saver, writes) = counting(Duration::from_millis(10));
        saver.mark();
        let until = Instant::now() + Duration::from_secs(5);
        while writes.load(Ordering::SeqCst) == 0 && Instant::now() < until {
            thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(writes.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn flush_does_not_wait_out_the_delay() {
        let (saver, writes) = counting(Duration::from_secs(60));
        saver.mark();
        let start = Instant::now();
        saver.flush();
        assert!(start.elapsed() < Duration::from_secs(5));
        assert_eq!(writes.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn mark_now_is_written_without_waiting_out_the_delay() {
        let (saver, writes) = counting(Duration::from_secs(60));
        saver.mark_now();
        let until = Instant::now() + Duration::from_secs(5);
        while writes.load(Ordering::SeqCst) == 0 && Instant::now() < until {
            thread::sleep(Duration::from_millis(5));
        }
        assert_eq!(writes.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn flush_with_nothing_pending_returns_and_writes_nothing() {
        let (saver, writes) = counting(Duration::from_millis(10));
        saver.flush();
        assert_eq!(writes.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn a_mark_during_a_write_gets_its_own_write() {
        let gate = Arc::new((Mutex::new(false), Condvar::new()));
        let writes = Arc::new(AtomicUsize::new(0));
        let (g, w) = (gate.clone(), writes.clone());
        let saver = Saver::spawn(Duration::ZERO, move || {
            if w.fetch_add(1, Ordering::SeqCst) == 0 {
                // Hold the first write until the test has marked again.
                let (open, cv) = &*g;
                let mut open = open.lock().unwrap();
                while !*open {
                    open = cv.wait(open).unwrap();
                }
            }
            Ok(())
        });
        saver.mark();
        while writes.load(Ordering::SeqCst) == 0 {
            thread::sleep(Duration::from_millis(1));
        }
        saver.mark();
        *gate.0.lock().unwrap() = true;
        gate.1.notify_all();
        saver.flush();
        assert_eq!(writes.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn an_error_stays_until_a_write_succeeds() {
        let fail = Arc::new(Mutex::new(true));
        let f = fail.clone();
        let saver =
            Saver::spawn(Duration::ZERO, move || if *f.lock().unwrap() { Err("disk full".into()) } else { Ok(()) });
        saver.mark();
        saver.flush();
        assert_eq!(saver.error().as_deref(), Some("disk full"));
        *fail.lock().unwrap() = false;
        saver.mark();
        saver.flush();
        assert_eq!(saver.error(), None);
    }

    #[test]
    fn write_atomic_replaces_the_file_and_leaves_no_temp() {
        let dir = std::env::temp_dir().join(format!("polar-saver-{}", std::process::id()));
        let path = dir.join("data.json");
        write_atomic(&path, b"one").unwrap();
        write_atomic(&path, b"two").unwrap();
        assert_eq!(fs::read(&path).unwrap(), b"two");
        #[cfg(unix)]
        assert_eq!(std::os::unix::fs::PermissionsExt::mode(&fs::metadata(&path).unwrap().permissions()) & 0o777, 0o600);
        assert!(!dir.join("data.json.tmp").exists());
        fs::remove_dir_all(dir).unwrap();
    }
}
