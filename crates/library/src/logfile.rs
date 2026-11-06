//! The app's log file (critique M14): `polar.log` in the app's log folder,
//! moved to `polar.log.1` when it passes a size, so the two never hold more
//! than about twice that. `src-tauri/src/logging.rs` hands it to `tracing`.
//!
//! What goes in is what the app writes there: hosts and plain reasons, never
//! keys, add-on links or titles. Links that slip in anyway (an error that
//! quotes its URL) are cut to their host on the way, as Copy Details does: add-on
//! and stream links carry keys and tokens (#195). A file that can't be opened or
//! written is skipped quietly: logging must never stop the app.

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
    /// The user's home folder as it may appear in a line (both slash kinds), written as `~`.
    home: Vec<String>,
}

impl LogFile {
    pub fn new(path: impl Into<PathBuf>, max: u64) -> Self {
        LogFile(Arc::new(Mutex::new(Inner { path: path.into(), max, open: None, home: Vec::new() })))
    }

    /// Paths under `home` are written from `~`, so the log never carries the user's name
    /// (`C:\Users\<name>\…`): people are asked to send its lines with bug reports (test report 1,
    /// item 30), and Copy Details hides the home folder the same way.
    pub fn hiding_home(self, home: &Path) -> Self {
        let h = home.to_string_lossy().trim_end_matches(['/', '\\']).to_owned();
        if h.len() > 1 {
            let mut inner = self.0.lock().unwrap_or_else(|p| p.into_inner());
            inner.home = vec![h.replace('/', "\\"), h.replace('\\', "/")];
            inner.home.dedup();
        }
        self
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

/// `text` with every link (`scheme://…`) cut to `<host>`, or None when there is none. The
/// user name and password, path, query and fragment are what carry keys; the host stays, to
/// say which server it was.
fn hide_links(text: &str) -> Option<String> {
    if !text.contains("://") {
        return None;
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(sep) = rest.find("://") {
        let scheme_len =
            rest[..sep].bytes().rev().take_while(|b| b.is_ascii_alphanumeric() || b"+.-".contains(b)).count();
        let start = sep - scheme_len;
        let after = &rest[sep + 3..];
        out.push_str(&rest[..start]);
        if scheme_len == 0 {
            // Not a link after all ("a :// b"): kept as it was.
            out.push_str("://");
            rest = after;
            continue;
        }
        // An IPv6 host's brackets belong to the link; a sentence's comma or full stop doesn't.
        let from = if after.starts_with('[') { after.find(']').map_or(0, |i| i + 1) } else { 0 };
        let end = after[from..]
            .find(|c: char| c.is_whitespace() || "\"'<>`)]}|^".contains(c))
            .map_or(after.len(), |i| i + from);
        let end = after[..end].trim_end_matches(['.', ',', ';', ':', '!', '?']).len().max(from);
        let link = &after[..end];
        let authority = &link[..link.find(['/', '?', '#']).unwrap_or(link.len())];
        out.push('<');
        out.push_str(&host_shown(authority.rsplit('@').next().unwrap_or_default()));
        out.push('>');
        rest = &after[end..];
    }
    out.push_str(rest);
    Some(out)
}

/// A link's host as the log names it: addresses on the user's own network aren't written
/// (AGENTS.md: no LAN addresses in logs), as in Copy Details (`src/lib/playback/startLog.ts`).
fn host_shown(host_port: &str) -> String {
    let host = match host_port.rsplit_once(':') {
        Some((h, port)) if port.bytes().all(|b| b.is_ascii_digit()) && !h.ends_with(':') => h,
        _ => host_port,
    };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if host.eq_ignore_ascii_case("localhost") {
        return "this computer".into();
    }
    match host.parse::<std::net::IpAddr>() {
        Ok(ip) if ip.is_loopback() => "this computer".into(),
        Ok(std::net::IpAddr::V4(v4)) if v4.is_private() || v4.is_link_local() => "a device on your network".into(),
        Ok(std::net::IpAddr::V6(v6))
            if (v6.segments()[0] & 0xfe00) == 0xfc00 || (v6.segments()[0] & 0xffc0) == 0xfe80 =>
        {
            "a device on your network".into()
        }
        _ => host_port.into(),
    }
}

/// `buf` with links cut to their host and the home folder written as `~`, or None when it
/// has neither.
fn hide(buf: &[u8], home: &[String]) -> Option<Vec<u8>> {
    let text = String::from_utf8_lossy(buf);
    let linked = hide_links(&text);
    let text = linked.as_deref().unwrap_or(&text);
    match hide_home(text, home) {
        Some(out) => Some(out.into_bytes()),
        None => linked.map(String::into_bytes),
    }
}

/// `text` with the home folder written as `~`, or None when it isn't in it.
fn hide_home(text: &str, home: &[String]) -> Option<String> {
    if home.is_empty() || !home.iter().any(|h| text.contains(h.as_str())) {
        return None;
    }
    let mut out = text.to_owned();
    for h in home {
        let mut from = 0;
        while let Some(at) = out[from..].find(h.as_str()).map(|i| i + from) {
            let end = at + h.len();
            // Only the whole folder: `C:\Users\Ada` isn't in `C:\Users\Adam`.
            if out[end..].chars().next().is_some_and(|c| c.is_alphanumeric() || "._-".contains(c)) {
                from = end;
                continue;
            }
            out.replace_range(at..end, "~");
            from = at + 1;
        }
    }
    Some(out)
}

impl Write for LogFile {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        let mut inner = self.0.lock().unwrap_or_else(|p| p.into_inner());
        let hidden = hide(buf, &inner.home);
        let bytes = hidden.as_deref().unwrap_or(buf);
        match inner.file(bytes.len() as u64).and_then(|f| f.write_all(bytes)) {
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
    fn the_home_folder_is_written_as_a_tilde() {
        let d = dir("home");
        let path = d.join("polar.log");
        let mut log = LogFile::new(&path, 1000).hiding_home(Path::new(r"C:\Users\Ada"));
        log.write_all(br"ERROR polar_lib::store: can't read C:\Users\Ada\AppData\Roaming\app\polar.json").unwrap();
        log.write_all(b"\nand C:/Users/Ada/x, but not C:\\Users\\Adam\n").unwrap();
        let text = fs::read_to_string(&path).unwrap();
        assert!(text.starts_with(r"ERROR polar_lib::store: can't read ~\AppData\Roaming\app\polar.json"), "{text}");
        assert!(text.contains("and ~/x"), "{text}");
        assert!(text.contains(r"but not C:\Users\Adam"), "{text}");
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn links_and_the_keys_in_them_never_reach_the_file() {
        let d = dir("links");
        let path = d.join("polar.log");
        let mut log = LogFile::new(&path, 10_000).hiding_home(Path::new("/home/ada"));
        log.write_all(
            b"WARN polar_addon: error sending request for url (https://addon.example.com/a8Fk2LmQ9xZ3pR7tY1wB/stream/movie/tt0000000.json)\n",
        )
        .unwrap();
        log.write_all(b"manifest https://user:TOKEN@media.example.com/manifest.json?apikey=xxx#frag failed, then \"http://192.0.2.1:11470/x?token=xxx\"\n").unwrap();
        log.write_all(b"a :// b, file at /home/ada/.config/app\n").unwrap();
        log.write_all(b"server http://192.168.1.20:11470/x, http://[fd00::1]:80/ and http://localhost:3000/y\n")
            .unwrap();
        let text = fs::read_to_string(&path).unwrap();
        for secret in ["a8Fk2LmQ9xZ3pR7tY1wB", "TOKEN", "apikey", "xxx", "tt0000000", "frag", "user"] {
            assert!(!text.contains(secret), "{secret} in {text}");
        }
        assert!(text.contains("for url (<addon.example.com>)"), "{text}");
        assert!(text.contains("manifest <media.example.com> failed, then \"<192.0.2.1:11470>\""), "{text}");
        assert!(text.contains("a :// b, file at ~/.config/app"), "{text}");
        assert!(
            text.contains("server <a device on your network>, <a device on your network> and <this computer>"),
            "{text}"
        );
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
