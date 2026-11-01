//! Embedded mpv playback engine.
//!
//! WebView2's `<video>` can't decode much of what p2ps carry: HEVC in MKV,
//! AC3/E-AC3/DTS/TrueHD audio (files play silently), PGS/ASS subtitles. mpv
//! plays all of it, so when it's available it becomes the player and the
//! React UI simply draws on top:
//!
//!   * mpv renders into the app window itself (`--wid=<hwnd>`), underneath a
//!     transparent webview — the page turns transparent while playing.
//!   * We drive it over its JSON IPC named pipe: commands go in with a
//!     `request_id`, replies and property changes come back as lines.
//!   * Observed properties are forwarded to the UI as `mpv://property`
//!     events (high-frequency ones throttled), lifecycle events as `mpv://event`.
//!
//! The process is started on first playback and kept alive (idle, black,
//! hidden under opaque pages) so the next title starts instantly; it's killed
//! when the app exits.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State, WebviewWindow};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, WriteHalf};
use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient};
use tokio::sync::{oneshot, Mutex};

use crate::AppState;

const OBSERVED: &[&str] = &[
    "pause",
    "time-pos",
    "duration",
    "paused-for-cache",
    "seeking",
    "eof-reached",
    "demuxer-cache-time",
    "track-list",
    "chapter-list",
    "aid",
    "sid",
    "volume",
    "mute",
    "speed",
];
/// Properties that change every frame; the UI interpolates between updates.
const THROTTLED: &[(&str, u64)] = &[("time-pos", 250), ("demuxer-cache-time", 1000)];
const REQUEST_TIMEOUT: Duration = Duration::from_secs(5);

type Pending = Arc<StdMutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

struct Conn {
    child: Child,
    writer: WriteHalf<NamedPipeClient>,
    pending: Pending,
}

#[derive(Default)]
pub struct Mpv {
    conn: Mutex<Option<Conn>>,
    next_id: AtomicU64,
}

/// mpv.exe: next to our binary (bundled), on PATH, or a standard install.
pub fn mpv_binary() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("mpv.exe"));
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|p| p.join("mpv.exe")));
    }
    for var in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Some(base) = std::env::var_os(var).map(PathBuf::from) {
            candidates.push(base.join("MPV Player").join("mpv.exe"));
            candidates.push(base.join("mpv").join("mpv.exe"));
            candidates.push(base.join("Programs").join("mpv").join("mpv.exe"));
        }
    }
    if let Some(home) = std::env::var_os("USERPROFILE").map(PathBuf::from) {
        candidates.push(home.join("scoop").join("apps").join("mpv").join("current").join("mpv.exe"));
    }
    candidates.into_iter().find(|p| p.is_file())
}

impl Mpv {
    /// Start mpv embedded in `window` if it isn't running yet.
    async fn ensure(&self, app: &AppHandle, window: &WebviewWindow) -> Result<(), String> {
        let mut guard = self.conn.lock().await;
        if let Some(conn) = guard.as_mut() {
            if matches!(conn.child.try_wait(), Ok(None)) {
                return Ok(());
            }
        }

        let bin = mpv_binary().ok_or("mpv isn't installed")?;
        let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
        let pipe = format!(r"\\.\pipe\polar-mpv-{}", std::process::id());
        let shots = std::env::temp_dir().join("polar-mpv");
        let _ = std::fs::create_dir_all(&shots);

        let mut cmd = Command::new(&bin);
        cmd.args([
            format!("--wid={hwnd}"),
            format!("--input-ipc-server={pipe}"),
            "--profile=libmpv".into(), // no OSC/OSD/default key bindings — our UI does that
            "--idle=yes".into(),
            "--keep-open=yes".into(),
            "--force-window=yes".into(),
            "--hwdec=auto-safe".into(),
            "--vo=gpu-next".into(),
            "--background-color=#000000".into(),
            "--cache=yes".into(),
            "--demuxer-max-bytes=400MiB".into(),
            "--demuxer-readahead-secs=60".into(),
            "--network-timeout=30".into(),
            "--ytdl=no".into(),
            "--sub-auto=no".into(),
            "--audio-file-auto=no".into(),
            // Subtitles: clean white type with a soft shadow, like the web player.
            "--sub-font=Segoe UI Semibold".into(),
            "--sub-font-size=42".into(),
            "--sub-border-size=1.6".into(),
            "--sub-shadow-offset=1".into(),
            "--sub-color=#FFFFFFFF".into(),
            "--screenshot-format=jpg".into(),
            "--screenshot-jpeg-quality=70".into(),
            format!("--screenshot-directory={}", shots.display()),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flash
        }
        let child = cmd.spawn().map_err(|e| format!("couldn't start mpv: {e}"))?;

        // The pipe appears once mpv has initialised.
        let started = Instant::now();
        let client = loop {
            match ClientOptions::new().open(&pipe) {
                Ok(c) => break c,
                Err(_) if started.elapsed() < Duration::from_secs(8) => tokio::time::sleep(Duration::from_millis(40)).await,
                Err(e) => return Err(format!("mpv didn't open its control pipe: {e}")),
            }
        };
        let (reader, writer) = tokio::io::split(client);
        let pending: Pending = Arc::default();
        tokio::spawn(read_loop(app.clone(), BufReader::new(reader), pending.clone()));
        *guard = Some(Conn { child, writer, pending });
        drop(guard);

        for (i, name) in OBSERVED.iter().enumerate() {
            self.request(json!(["observe_property", i + 1, name])).await?;
        }
        Ok(())
    }

    async fn request(&self, command: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        let (tx, rx) = oneshot::channel();
        {
            let mut guard = self.conn.lock().await;
            let conn = guard.as_mut().ok_or("mpv isn't running")?;
            conn.pending.lock().unwrap().insert(id, tx);
            let mut line = serde_json::to_vec(&json!({ "command": command, "request_id": id })).unwrap();
            line.push(b'\n');
            conn.writer.write_all(&line).await.map_err(|e| e.to_string())?;
        }
        match tokio::time::timeout(REQUEST_TIMEOUT, rx).await {
            Ok(Ok(result)) => result,
            _ => Err("mpv didn't respond".into()),
        }
    }

    pub fn kill(&self) {
        if let Ok(mut guard) = self.conn.try_lock() {
            if let Some(mut conn) = guard.take() {
                let _ = conn.child.kill();
            }
        }
    }
}

async fn read_loop(app: AppHandle, mut reader: BufReader<tokio::io::ReadHalf<NamedPipeClient>>, pending: Pending) {
    let mut last_emit: HashMap<String, Instant> = HashMap::new();
    let mut line = String::new();
    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {}
        }
        let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };

        if let Some(id) = msg.get("request_id").and_then(Value::as_u64) {
            if let Some(tx) = pending.lock().unwrap().remove(&id) {
                let ok = msg.get("error").and_then(Value::as_str) == Some("success");
                let result = if ok {
                    Ok(msg.get("data").cloned().unwrap_or(Value::Null))
                } else {
                    Err(msg.get("error").and_then(Value::as_str).unwrap_or("error").to_owned())
                };
                let _ = tx.send(result);
            }
            continue;
        }

        match msg.get("event").and_then(Value::as_str) {
            Some("property-change") => {
                let name = msg.get("name").and_then(Value::as_str).unwrap_or_default().to_owned();
                if let Some((_, every)) = THROTTLED.iter().find(|(n, _)| *n == name) {
                    let now = Instant::now();
                    if last_emit.get(&name).is_some_and(|t| now.duration_since(*t) < Duration::from_millis(*every)) {
                        continue;
                    }
                    last_emit.insert(name.clone(), now);
                }
                let _ = app.emit("mpv://property", json!({ "name": name, "data": msg.get("data") }));
            }
            Some(_) => {
                let _ = app.emit("mpv://event", &msg);
            }
            None => {}
        }
    }
    let _ = app.emit("mpv://event", json!({ "event": "shutdown" }));
}

// --- Commands --------------------------------------------------------------

#[tauri::command]
pub fn mpv_available() -> bool {
    mpv_binary().is_some()
}

/// Load `url` (optionally starting at `start` seconds) and play.
#[tauri::command]
pub async fn mpv_load(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    url: String,
    start: Option<f64>,
) -> Result<(), String> {
    state.mpv.ensure(&app, &window).await?;
    let mut options = String::new();
    if let Some(s) = start.filter(|s| *s > 1.0) {
        options = format!("start={s:.2}");
    }
    state.mpv.request(json!(["loadfile", url, "replace", -1, options])).await?;
    state.mpv.request(json!(["set_property", "pause", false])).await?;
    Ok(())
}

/// Any mpv command, e.g. `["seek", 10, "relative"]`.
#[tauri::command]
pub async fn mpv_command(state: State<'_, AppState>, args: Vec<Value>) -> Result<Value, String> {
    state.mpv.request(Value::Array(args)).await
}

#[tauri::command]
pub async fn mpv_set(state: State<'_, AppState>, name: String, value: Value) -> Result<(), String> {
    state.mpv.request(json!(["set_property", name, value])).await.map(|_| ())
}

/// Stop playback but keep mpv alive (idle) for the next title.
#[tauri::command]
pub async fn mpv_stop(state: State<'_, AppState>) -> Result<(), String> {
    if state.mpv.conn.lock().await.is_none() {
        return Ok(());
    }
    state.mpv.request(json!(["stop"])).await.map(|_| ())
}

/// The current frame as a JPEG data URL — mpv's picture lives in a native
/// window the page can't sample, so overlays blur this snapshot instead.
#[tauri::command]
pub async fn mpv_snapshot(state: State<'_, AppState>) -> Result<String, String> {
    let path = std::env::temp_dir().join("polar-mpv").join("frame.jpg");
    let path_str = path.to_string_lossy().to_string();
    state.mpv.request(json!(["screenshot-to-file", path_str, "video"])).await?;
    let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    use base64::Engine as _;
    Ok(format!("data:image/jpeg;base64,{}", base64::engine::general_purpose::STANDARD.encode(bytes)))
}
