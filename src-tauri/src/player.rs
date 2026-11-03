//! Embedded mpv playback engine.
//!
//! WebView2's `<video>` can't decode much of what p2ps carry: HEVC in MKV,
//! AC3/E-AC3/DTS/TrueHD audio (files play silently), PGS/ASS subtitles. mpv
//! plays all of it, so when it's available it becomes the player and the
//! React UI simply draws on top:
//!
//!   * mpv renders into the app window itself (`--wid`: the HWND on Windows,
//!     the window's NSView on macOS), underneath a transparent webview — the
//!     page turns transparent while playing.
//!   * We drive it over its JSON IPC (a named pipe on Windows, a Unix socket
//!     elsewhere): commands go in with a
//!     `request_id`, replies and property changes come back as lines.
//!   * Observed properties are forwarded to the UI as `mpv://property`
//!     events (high-frequency ones throttled), lifecycle events as `mpv://event`.
//!
//! The process is started on first playback and kept alive (idle, black,
//! hidden under opaque pages) so the next title starts instantly; it's shut
//! down after a few idle minutes (to give its memory back) and when the app exits.

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, WriteHalf};
use tokio::sync::{oneshot, Mutex};

use ipc::Stream as IpcStream;

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
/// How long an idle mpv is kept around after playback stops. Re-using it saves
/// ~150 ms of startup; past this it's not worth the GPU/RAM it holds.
const IDLE_SHUTDOWN: Duration = Duration::from_secs(5 * 60);

/// Options only newer mpv builds know. An unknown option is fatal at startup,
/// so if a user's older mpv (found on PATH) exits immediately, we retry without them.
const MODERN_ARGS: &[&str] = &[
    // mpv's built-in Lua scripts each run their own VM + thread (~6 MiB,
    // 5 threads together). Our UI replaces all of them.
    "--load-stats-overlay=no",
    "--load-console=no",
    "--load-select=no",
    "--load-commands=no",
    "--load-positioning=no",
    "--load-auto-profiles=no",
];

type Pending = Arc<StdMutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>>;

struct Conn {
    child: Child,
    writer: WriteHalf<IpcStream>,
    pending: Pending,
    /// Set before an intentional kill so the reader doesn't report a crash.
    quiet: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct Mpv {
    conn: Mutex<Option<Conn>>,
    next_id: AtomicU64,
    /// Bumped on every load/stop; an idle-shutdown timer only fires if it's unchanged.
    idle_gen: AtomicU64,
    /// What mpv is currently tuned to, so `mpv_tune` only sends changes:
    /// re-setting `hwdec` to the same value can still reinitialise decoding.
    tuned: StdMutex<Tune>,
}

/// The mpv executable's file name here.
const MPV_EXE: &str = if cfg!(windows) { "mpv.exe" } else { "mpv" };

/// mpv: next to our binary (bundled), on PATH, or a standard install.
pub fn mpv_binary() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join(MPV_EXE));
        }
    }
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|p| p.join(MPV_EXE)));
    }
    #[cfg(windows)]
    {
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
    }
    // Apps launched from Finder don't get the shell's PATH, so Homebrew's
    // and MacPorts' bins (and mpv.app) are looked up by name.
    #[cfg(target_os = "macos")]
    {
        candidates.push("/opt/homebrew/bin/mpv".into());
        candidates.push("/usr/local/bin/mpv".into());
        candidates.push("/opt/local/bin/mpv".into());
        candidates.push("/Applications/mpv.app/Contents/MacOS/mpv".into());
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            candidates.push(home.join("Applications/mpv.app/Contents/MacOS/mpv"));
        }
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// The native view mpv draws into (`--wid`).
fn window_id(window: &WebviewWindow) -> Result<String, String> {
    #[cfg(windows)]
    {
        Ok((window.hwnd().map_err(|e| e.to_string())?.0 as isize).to_string())
    }
    #[cfg(target_os = "macos")]
    {
        Ok((window.ns_view().map_err(|e| e.to_string())? as usize).to_string())
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let _ = window;
        Err("the built-in mpv player isn't supported on this system yet".into())
    }
}

/// mpv's IPC transport: a named pipe on Windows, a Unix socket elsewhere.
mod ipc {
    #[cfg(windows)]
    pub type Stream = tokio::net::windows::named_pipe::NamedPipeClient;
    #[cfg(unix)]
    pub type Stream = tokio::net::UnixStream;

    /// Where this app instance's mpv listens.
    pub fn endpoint() -> String {
        #[cfg(windows)]
        {
            format!(r"\\.\pipe\polar-mpv-{}", std::process::id())
        }
        #[cfg(unix)]
        {
            let path = std::env::temp_dir().join(format!("polar-mpv-{}.sock", std::process::id()));
            // A socket left by an earlier run with this pid would refuse mpv's bind.
            let _ = std::fs::remove_file(&path);
            path.to_string_lossy().into_owned()
        }
    }

    pub async fn connect(endpoint: &str) -> std::io::Result<Stream> {
        #[cfg(windows)]
        {
            tokio::net::windows::named_pipe::ClientOptions::new().open(endpoint)
        }
        #[cfg(unix)]
        {
            tokio::net::UnixStream::connect(endpoint).await
        }
    }
}

/// Rendering: Direct3D 11 on Windows (lighter than Vulkan, zero-copy with
/// d3d11va); elsewhere mpv's own choice for the platform.
fn gpu_args() -> Vec<String> {
    if cfg!(windows) {
        vec!["--gpu-api=d3d11".into()]
    } else {
        Vec::new()
    }
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
        let wid = window_id(window)?;
        let pipe = ipc::endpoint();
        let shots = std::env::temp_dir().join("polar-mpv");
        let _ = std::fs::create_dir_all(&shots);
        // Compiled shaders persist here, so the first frame after an app
        // restart doesn't wait on shader compilation.
        let shader_cache = app
            .path()
            .app_cache_dir()
            .unwrap_or_else(|_| shots.clone())
            .join("mpv-shaders");
        let _ = std::fs::create_dir_all(&shader_cache);

        let mut base: Vec<String> = vec![
            format!("--wid={wid}"),
            format!("--input-ipc-server={pipe}"),
            "--profile=libmpv".into(), // no OSC/OSD/default key bindings — our UI does that
            // Ignore a user's own mpv.conf/scripts: heavy shaders or
            // interpolation from a desktop setup don't belong in the embed.
            "--config=no".into(),
            "--idle=yes".into(),
            "--keep-open=yes".into(),
            "--force-window=yes".into(),
            "--hwdec=auto-safe".into(), // d3d11va / videotoolbox: decoded frames stay on the GPU
            "--vo=gpu-next".into(),
            format!("--gpu-shader-cache-dir={}", shader_cache.display()),
            "--background-color=#000000".into(),
            // Cache: with --cache=yes mpv ignores --demuxer-readahead-secs and
            // uses --cache-secs (default: 1000 hours), so it always filled the
            // whole byte limit. Now: up to 90 s ahead, capped at 192 MiB
            // (~20 s of a 4K remux, minutes of a typical 1080p stream), with
            // 32 MiB kept behind for instant short rewinds.
            "--cache=yes".into(),
            "--cache-secs=90".into(),
            "--demuxer-max-bytes=192MiB".into(),
            "--demuxer-max-back-bytes=32MiB".into(),
            // Once full, read again in bursts (when 60 s remain) instead of
            // waking up for every packet.
            "--demuxer-hysteresis-secs=60".into(),
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
        ];
        base.extend(gpu_args());

        let (child, client) = match launch(&bin, &base, true, &pipe).await? {
            Some(ok) => ok,
            // Exited during startup: most likely an older mpv that rejects
            // a newer option.
            None => launch(&bin, &base, false, &pipe)
                .await?
                .ok_or("mpv exited during startup")?,
        };
        let (reader, writer) = tokio::io::split(client);
        let pending: Pending = Arc::default();
        let quiet = Arc::new(AtomicBool::new(false));
        tokio::spawn(read_loop(app.clone(), BufReader::new(reader), pending.clone(), quiet.clone()));
        *guard = Some(Conn { child, writer, pending, quiet });
        // A fresh mpv starts from the launch arguments above.
        *self.tuned.lock().unwrap() = Tune::default();
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
                conn.quiet.store(true, Ordering::Relaxed);
                let _ = conn.child.kill();
            }
        }
    }

    /// Cancel any pending idle shutdown (a new title is starting).
    fn touch(&self) {
        self.idle_gen.fetch_add(1, Ordering::Relaxed);
    }

    /// Shut mpv down if nothing plays for `IDLE_SHUTDOWN`: an idle mpv still
    /// holds its swapchain, decoder pools and ~40+ MiB of RAM.
    fn schedule_idle_shutdown(&self, app: &AppHandle) {
        let generation = self.idle_gen.fetch_add(1, Ordering::Relaxed) + 1;
        let app = app.clone();
        tokio::spawn(async move {
            tokio::time::sleep(IDLE_SHUTDOWN).await;
            let mpv = &app.state::<AppState>().mpv;
            let mut guard = mpv.conn.lock().await;
            if mpv.idle_gen.load(Ordering::Relaxed) != generation {
                return;
            }
            if let Some(mut conn) = guard.take() {
                conn.quiet.store(true, Ordering::Relaxed);
                let _ = conn.child.kill();
                let _ = conn.child.wait();
            }
        });
    }
}

/// Spawn mpv and connect to its IPC pipe. `Ok(None)` means mpv exited before
/// the pipe appeared (only reported when `modern` is set, so the caller can
/// retry without the newer options).
async fn launch(
    bin: &PathBuf,
    base: &[String],
    modern: bool,
    pipe: &str,
) -> Result<Option<(Child, IpcStream)>, String> {
    let mut cmd = Command::new(bin);
    cmd.args(base);
    if modern {
        cmd.args(MODERN_ARGS);
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW: no console flash
    }
    let mut child = cmd.spawn().map_err(|e| format!("couldn't start mpv: {e}"))?;

    // The pipe appears once mpv has initialised.
    let started = Instant::now();
    loop {
        match ipc::connect(pipe).await {
            Ok(c) => return Ok(Some((child, c))),
            Err(_) if modern && matches!(child.try_wait(), Ok(Some(_))) => return Ok(None),
            Err(_) if started.elapsed() < Duration::from_secs(8) => tokio::time::sleep(Duration::from_millis(15)).await,
            Err(e) => {
                let _ = child.kill();
                return Err(format!("mpv didn't open its control pipe: {e}"));
            }
        }
    }
}

async fn read_loop(
    app: AppHandle,
    mut reader: BufReader<tokio::io::ReadHalf<IpcStream>>,
    pending: Pending,
    quiet: Arc<AtomicBool>,
) {
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
    if !quiet.load(Ordering::Relaxed) {
        let _ = app.emit("mpv://event", json!({ "event": "shutdown" }));
    }
}

// --- Commands --------------------------------------------------------------

#[tauri::command]
pub fn mpv_available() -> bool {
    mpv_binary().is_some()
}

// --- What the webview may ask of mpv --------------------------------------
//
// mpv's IPC is all-powerful: `run` starts any program, `load-script` runs Lua,
// and some properties write files. The webview renders data from third-party
// addons, so it only gets the handful of commands and properties the player
// UI actually uses — a script injected into the page can't turn the player
// into a way to run code on the machine.

/// Commands the UI sends through `mpv_command`.
const ALLOWED_COMMANDS: &[&str] = &["seek", "set", "get_property", "sub-add"];

/// Properties the UI reads or writes (`mpv_set`, `set`, `get_property`).
const ALLOWED_PROPERTIES: &[&str] = &[
    "pause",
    "volume",
    "mute",
    "speed",
    "aid",
    "sid",
    "sub-text",
    "sub-ass-override",
    "sub-font",
    "sub-scale",
    "sub-pos",
    "sub-color",
    "sub-border-size",
    "sub-border-color",
    "sub-border-style",
    "sub-shadow-offset",
    "sub-back-color",
    "sub-delay",
];

/// Media and subtitles only ever come from the network (addons, or the local
/// bridge); never local files or mpv's special protocols.
fn is_web_url(url: &str) -> bool {
    let lower = url.trim_start().to_ascii_lowercase();
    lower.starts_with("https://") || lower.starts_with("http://")
}

fn check_command(args: &[Value]) -> Result<(), String> {
    let name = args.first().and_then(Value::as_str).ok_or("missing mpv command")?;
    if !ALLOWED_COMMANDS.contains(&name) {
        return Err(format!("mpv command `{name}` isn't allowed"));
    }
    match name {
        "set" | "get_property" => check_property(args.get(1).and_then(Value::as_str).unwrap_or_default()),
        "sub-add" => match args.get(1).and_then(Value::as_str) {
            Some(url) if is_web_url(url) => Ok(()),
            _ => Err("subtitles must be an http(s) URL".into()),
        },
        _ => Ok(()),
    }
}

fn check_property(name: &str) -> Result<(), String> {
    if ALLOWED_PROPERTIES.contains(&name) {
        Ok(())
    } else {
        Err(format!("mpv property `{name}` isn't allowed"))
    }
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
    // Web streams, or a finished download - never any other path on disk.
    let downloaded = app.state::<Arc<crate::downloads::Downloads>>().owns(&url);
    if !is_web_url(&url) && !downloaded {
        return Err("only http(s) streams and downloads can be played".into());
    }
    // A service link that's not ready yet, or a status clip in place of the video.
    let url = if downloaded { url } else { crate::streamcheck::prepare(&url).await? };
    state.mpv.touch();
    state.mpv.ensure(&app, &window).await?;
    let mut options = String::new();
    if let Some(s) = start.filter(|s| *s > 1.0) {
        options = format!("start={s:.2}");
    }
    state.mpv.request(json!(["loadfile", url, "replace", -1, options])).await?;
    state.mpv.request(json!(["set_property", "pause", false])).await?;
    Ok(())
}

/// An allow-listed mpv command, e.g. `["seek", 10, "relative"]`.
#[tauri::command]
pub async fn mpv_command(state: State<'_, AppState>, args: Vec<Value>) -> Result<Value, String> {
    check_command(&args)?;
    state.mpv.request(Value::Array(args)).await
}

#[tauri::command]
pub async fn mpv_set(state: State<'_, AppState>, name: String, value: Value) -> Result<(), String> {
    check_property(&name)?;
    state.mpv.request(json!(["set_property", name, value])).await.map(|_| ())
}

/// Device-level picture and sound options (Settings → Subtitles & Audio and
/// → Advanced). Presets, not raw values: `af` takes lavfi graphs, which can
/// read files, so the page never gets to write it directly.
#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tune {
    /// Fold surround down to stereo with the centre (dialogue) channel
    /// louder. Only sent for tracks with more than two channels.
    pub dialogue_boost: bool,
    /// Even out loud and quiet scenes ("night mode").
    pub volume_leveling: bool,
    /// Hardware decoding. Off is a troubleshooting switch for broken drivers.
    pub hwdec: bool,
    /// Smooth colour banding in gradients (dark scenes, anime skies).
    pub deband: bool,
    /// Read-ahead: "small", "normal" or "large".
    pub buffer: BufferSize,
}

#[derive(Debug, Clone, Copy, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum BufferSize {
    Small,
    Normal,
    Large,
}

/// What the launch arguments in `Mpv::ensure` amount to.
impl Default for Tune {
    fn default() -> Self {
        Self { dialogue_boost: false, volume_leveling: false, hwdec: true, deband: false, buffer: BufferSize::Normal }
    }
}

impl Tune {
    fn audio_filters(&self) -> String {
        let mut chain: Vec<&str> = Vec::new();
        if self.dialogue_boost {
            // The well-known mpv downmix: centre at full level, the rest at 30%.
            chain.push("lavfi=[pan=stereo|FL<FC+0.30*FL+0.30*BL+0.30*SL|FR<FC+0.30*FR+0.30*BR+0.30*SR]");
        }
        if self.volume_leveling {
            chain.push("lavfi=[dynaudnorm=f=150:g=15:p=0.9]");
        }
        chain.join(",")
    }

    /// (seconds ahead, max bytes) for the demuxer cache.
    fn cache(&self) -> (u32, &'static str) {
        match self.buffer {
            BufferSize::Small => (30, "64MiB"),
            BufferSize::Normal => (90, "192MiB"),
            BufferSize::Large => (300, "768MiB"),
        }
    }
}

/// Apply [`Tune`] to the running mpv. Takes effect immediately (audio
/// filters, decoding, debanding) or from the next read-ahead (cache).
#[tauri::command]
pub async fn mpv_tune(state: State<'_, AppState>, tune: Tune) -> Result<(), String> {
    if state.mpv.conn.lock().await.is_none() {
        return Ok(());
    }
    let mpv = &state.mpv;
    let was = *mpv.tuned.lock().unwrap();
    if was == tune {
        return Ok(());
    }
    if was.audio_filters() != tune.audio_filters() {
        mpv.request(json!(["set_property", "af", tune.audio_filters()])).await?;
    }
    if was.hwdec != tune.hwdec {
        mpv.request(json!(["set_property", "hwdec", if tune.hwdec { "auto-safe" } else { "no" }])).await?;
    }
    if was.deband != tune.deband {
        mpv.request(json!(["set_property", "deband", tune.deband])).await?;
    }
    if was.buffer != tune.buffer {
        let (secs, bytes) = tune.cache();
        mpv.request(json!(["set_property", "cache-secs", secs])).await?;
        mpv.request(json!(["set_property", "demuxer-max-bytes", bytes])).await?;
    }
    *mpv.tuned.lock().unwrap() = tune;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tune_builds_fixed_filters() {
        let t = Tune { dialogue_boost: true, volume_leveling: true, hwdec: true, deband: false, buffer: BufferSize::Large };
        assert!(t.audio_filters().starts_with("lavfi=[pan=stereo") && t.audio_filters().contains("dynaudnorm"));
        let off = Tune { dialogue_boost: false, volume_leveling: false, ..t };
        assert_eq!(off.audio_filters(), "");
        assert_eq!(t.cache(), (300, "768MiB"));
    }

    #[test]
    fn only_player_commands_pass() {
        assert!(check_command(&[json!("seek"), json!(10), json!("absolute+keyframes")]).is_ok());
        assert!(check_command(&[json!("set"), json!("sub-border-style"), json!("opaque-box")]).is_ok());
        assert!(check_command(&[json!("sub-add"), json!("https://x/s.srt"), json!("select")]).is_ok());
        assert!(check_command(&[json!("run"), json!("cmd.exe")]).is_err());
        assert!(check_command(&[json!("load-script"), json!("C:/x.lua")]).is_err());
        assert!(check_command(&[json!("set"), json!("input-ipc-server"), json!("x")]).is_err());
        assert!(check_command(&[json!("sub-add"), json!("C:/secret.txt")]).is_err());
        assert!(check_command(&[]).is_err());
        assert!(check_property("screenshot-directory").is_err());
        assert!(!is_web_url("file:///C:/x.mkv") && is_web_url("HTTP://127.0.0.1:11470/a/0"));
    }
}

/// Stop playback but keep mpv alive (idle) for the next title.
#[tauri::command]
pub async fn mpv_stop(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    if state.mpv.conn.lock().await.is_none() {
        return Ok(());
    }
    state.mpv.schedule_idle_shutdown(&app);
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
