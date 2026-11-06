//! Autocrop's pre-roll probe (docs/autocrop.md §3): while the player
//! buffers, a second mpv with no picture or sound measures keyframes over
//! the film's opening, so the crop is right on the first frame.
//!
//! mpv's JSON IPC can't carry `screenshot-raw`'s bytes, so each keyframe is
//! written as an uncompressed PNG ([`polar_player::png`]) to this app's
//! screenshot folder, read and deleted.

/// A load's opening crop, handed from `mpv_load` to the autocrop loop.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) enum Opening {
    /// The probe of this load is still running: hold the tracker back.
    Probing(u64),
    /// This load starts with `bars` removed from frames of size `full`.
    Ready { load: u64, full: (i64, i64), bars: (i64, i64) },
}

/// What the probe found: the frame size, its display size and the bars at
/// least 5 of 8 keyframes agree on.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct Found {
    pub full: (i64, i64),
    pub display: (i64, i64),
    pub bars: (i64, i64),
}

/// The opening bars of `url` (sent with header `fields`, played from
/// `start` s), or `None` when the probe can't run here or finds none clear
/// within 1.5 s.
pub(super) async fn opening(url: String, fields: Vec<String>, start: f64) -> Option<Found> {
    imp::opening(url, fields, start).await
}

/// Kill any probe still running (the app is closing).
pub(super) fn kill_all() {
    imp::kill_all();
}

#[cfg(target_os = "macos")]
mod imp {
    use super::Found;

    /// libmpv runs inside the app here, with no second instance to probe with yet.
    pub(super) async fn opening(_url: String, _fields: Vec<String>, _start: f64) -> Option<Found> {
        None
    }

    pub(super) fn kill_all() {}
}

#[cfg(not(target_os = "macos"))]
mod imp {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Arc, Mutex as StdMutex};
    use std::time::Duration;

    use polar_player::bars::{detect, levels_for, Measured};
    use polar_player::crop::{opening_bars, opening_points};
    use polar_player::png::decode_stored;
    use serde_json::{json, Value};
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, ReadHalf, WriteHalf};
    use tokio::sync::mpsc;

    use super::Found;
    use crate::locks::Locked;
    use crate::player::ipc::{self, Stream};
    use crate::player::{kill_process, launch, mpv_binary, shots_dir, Process};

    /// How long a load waits for the probe, at most; it uses what came by then.
    const BUDGET: Duration = Duration::from_millis(1500);

    /// One keyframe's reading, with the sizes it belongs to.
    type Reading = ((i64, i64), (i64, i64), Option<Measured>);

    /// The probes running now, by number, so the app never leaves one behind.
    static RUNNING: StdMutex<Vec<(u64, Process)>> = StdMutex::new(Vec::new());

    pub(super) fn kill_all() {
        for (_, child) in RUNNING.locked().drain(..) {
            kill_process(&child);
        }
    }

    pub(super) async fn opening(url: String, fields: Vec<String>, start: f64) -> Option<Found> {
        let (tx, mut rx) = mpsc::unbounded_channel();
        tokio::spawn(probe(url, fields, start, tx));
        let deadline = tokio::time::Instant::now() + BUDGET;
        let mut sizes = None;
        let mut readings = Vec::new();
        while let Ok(Some((full, display, m))) = tokio::time::timeout_at(deadline, rx.recv()).await {
            sizes = Some((full, display));
            readings.push(m);
        }
        // The probe sees the channel close and stops: its mpv is killed, its files removed.
        drop(rx);
        let (full, display) = sizes?;
        let bars = opening_bars(full, &readings);
        tracing::debug!("autocrop pre-roll: {} readings, bars {bars:?}", readings.len());
        (bars != (0, 0)).then_some(Found { full, display, bars })
    }

    /// The probe's mpv and its screenshot folder, gone when this is dropped.
    struct Probe {
        n: u64,
        child: Process,
        dir: PathBuf,
        reader: BufReader<ReadHalf<Stream>>,
        writer: WriteHalf<Stream>,
        next: u64,
        /// Events seen since the last [`Probe::forget`].
        events: Vec<String>,
    }

    impl Drop for Probe {
        fn drop(&mut self) {
            kill_process(&self.child);
            RUNNING.locked().retain(|(n, _)| *n != self.n);
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    impl Probe {
        async fn command(&mut self, command: Value) -> Option<Value> {
            self.next += 1;
            let mut line = serde_json::to_vec(&json!({ "command": command, "request_id": self.next })).ok()?;
            line.push(b'\n');
            self.writer.write_all(&line).await.ok()?;
            loop {
                let msg = self.message().await?;
                if msg.get("request_id").and_then(Value::as_u64) == Some(self.next) {
                    return (msg.get("error").and_then(Value::as_str) == Some("success"))
                        .then(|| msg.get("data").cloned().unwrap_or(Value::Null));
                }
            }
        }

        /// The next of `names` to happen (or to have happened since [`Probe::forget`]).
        async fn event(&mut self, names: &[&str]) -> Option<String> {
            loop {
                if let Some(e) = self.events.iter().find(|e| names.contains(&e.as_str())) {
                    return Some(e.clone());
                }
                self.message().await?;
            }
        }

        fn forget(&mut self) {
            self.events.clear();
        }

        /// Read one line, noting it if it's an event.
        async fn message(&mut self) -> Option<Value> {
            let mut line = String::new();
            loop {
                line.clear();
                if self.reader.read_line(&mut line).await.ok()? == 0 {
                    return None;
                }
                if let Ok(msg) = serde_json::from_str::<Value>(&line) {
                    if let Some(e) = msg.get("event").and_then(Value::as_str) {
                        self.events.push(e.to_owned());
                    }
                    return Some(msg);
                }
            }
        }
    }

    /// Open `url` in a probe and send a reading of each keyframe at
    /// [`opening_points`], until done or `tx`'s receiver is gone. Starting
    /// mpv isn't cut short (a process mid-start would be left running), so
    /// the probe may outlast the load's wait by that much.
    async fn probe(url: String, fields: Vec<String>, start: f64, tx: mpsc::UnboundedSender<Reading>) -> Option<()> {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        let bin = mpv_binary()?;
        let pipe = ipc::endpoint(&format!("probe-{n}"));
        let dir = shots_dir().join(format!("probe-{n}"));
        std::fs::create_dir_all(&dir).ok()?;
        let args: Vec<String> = vec![
            format!("--input-ipc-server={pipe}"),
            "--config=no".into(),
            "--idle=yes".into(),
            "--pause=yes".into(),
            "--terminal=no".into(),
            // No picture, sound or subtitles: frames come out as screenshots.
            "--vo=null".into(),
            "--ao=null".into(),
            "--aid=no".into(),
            "--sid=no".into(),
            // Every seek lands on a keyframe, and only keyframes are decoded, in software.
            "--hr-seek=no".into(),
            "--vd-lavc-skipframe=nonkey".into(),
            "--hwdec=no".into(),
            "--cache=no".into(),
            "--demuxer-max-bytes=8MiB".into(),
            "--demuxer-readahead-secs=1".into(),
            "--network-timeout=10".into(),
            "--ytdl=no".into(),
            "--sub-auto=no".into(),
            "--audio-file-auto=no".into(),
            "--screenshot-sw=yes".into(),
            "--screenshot-format=png".into(),
            "--screenshot-png-compression=0".into(),
            "--screenshot-png-filter=0".into(),
            "--screenshot-high-bit-depth=no".into(),
            "--screenshot-tag-colorspace=no".into(),
        ];
        let (child, client) = match launch(&bin, &args, true, &pipe).await.ok()? {
            Some(ok) => ok,
            None => launch(&bin, &args, false, &pipe).await.ok()??,
        };
        let (reader, writer) = tokio::io::split(client);
        let child: Process = Arc::new(StdMutex::new(child));
        RUNNING.locked().push((n, child.clone()));
        let mut p = Probe { n, child, dir, reader: BufReader::new(reader), writer, next: 0, events: Vec::new() };
        tokio::select! {
            done = measure(&mut p, url, fields, start, &tx) => done,
            () = tx.closed() => None,
        }
    }

    async fn measure(
        p: &mut Probe,
        url: String,
        fields: Vec<String>,
        start: f64,
        tx: &mpsc::UnboundedSender<Reading>,
    ) -> Option<()> {
        p.command(json!(["set_property", "http-header-fields", fields])).await?;
        p.forget();
        p.command(json!(["loadfile", url, "replace"])).await?;
        // Paused, mpv still shows the first frame: then the video's size is known.
        if p.event(&["playback-restart", "end-file"]).await? != "playback-restart" {
            return None;
        }
        let duration = p.command(json!(["get_property", "duration"])).await.and_then(|d| d.as_f64());
        let params = p.command(json!(["get_property", "video-params"])).await?;
        let int = |k: &str| params.get(k).and_then(Value::as_i64).filter(|n| *n > 0);
        let (full, display) = ((int("w")?, int("h")?), (int("dw")?, int("dh")?));
        let levels = levels_for(params.get("gamma").and_then(Value::as_str));

        for (i, t) in opening_points(duration, start).into_iter().enumerate() {
            p.forget();
            if p.command(json!(["seek", t, "absolute+keyframes"])).await.is_none() {
                continue;
            }
            if p.event(&["playback-restart", "end-file"]).await? != "playback-restart" {
                return None;
            }
            let path = p.dir.join(format!("{i}.png"));
            let measured = match p.command(json!(["screenshot-to-file", path.to_string_lossy(), "video"])).await {
                Some(_) => {
                    let bytes = tokio::fs::read(&path).await.ok();
                    let _ = tokio::fs::remove_file(&path).await;
                    let Some(img) = bytes.as_deref().and_then(decode_stored) else { continue };
                    let shot = (img.w as i64, img.h as i64);
                    detect(&img.frame(), levels).map(|m| m.scaled(shot, full))
                }
                None => continue,
            };
            tx.send((full, display, measured)).ok()?;
        }
        Some(())
    }
}
