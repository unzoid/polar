//! Embedded mpv playback engine.
//!
//! WebView2's `<video>` can't decode much of what add-ons link to: HEVC in MKV,
//! AC3/E-AC3/DTS/TrueHD audio (files play silently), PGS/ASS subtitles. mpv
//! plays all of it, so when it's available it becomes the player and the
//! React UI simply draws on top:
//!
//!   * mpv renders into the app window itself, underneath a transparent
//!     webview — the page turns transparent while playing. On Windows mpv is
//!     its own process drawing into our HWND (`--wid`). On macOS a window
//!     handle can't be shared with another process, so libmpv runs inside the
//!     app and draws into a layer under the webview (`macos/mpv_view.m`).
//!   * We drive it over its JSON IPC (a named pipe on Windows, a Unix socket
//!     elsewhere): commands go in with a
//!     `request_id`, replies and property changes come back as lines.
//!   * Observed properties are forwarded to the UI as `mpv://property`
//!     events (high-frequency ones throttled), lifecycle events as `mpv://event`.
//!
//! The process is started on first playback and kept alive (idle, black,
//! hidden under opaque pages) so the next title starts instantly; it's shut
//! down after a few idle minutes (to give its memory back) and when the app exits.
//!
//! Here: [`Mpv`], the engines and the IPC reader. [`commands`] holds the
//! `mpv_*` commands, [`autocrop`] the black-bar zoom, [`ipc`] the transport.

mod autocrop;
mod commands;
mod ipc;

pub use commands::*;

use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Child;
#[cfg(not(target_os = "macos"))]
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, WriteHalf};
use tokio::sync::{mpsc, oneshot, Mutex};

use autocrop::CROP_OBSERVE_BASE;
use ipc::Stream as IpcStream;

use polar_player::tune::Tune;

use crate::locks::Locked;
use crate::AppState;

const OBSERVED: &[&str] = &[
    "pause",
    "time-pos",
    "duration",
    "paused-for-cache",
    "seeking",
    "eof-reached",
    "demuxer-cache-time",
    // For the loading screen's step log.
    "cache-buffering-state",
    "file-format",
    "track-list",
    "chapter-list",
    "aid",
    "sid",
    "volume",
    "mute",
    "speed",
];
/// Properties that change every frame; the UI interpolates between updates.
const THROTTLED: &[(&str, u64)] = &[("time-pos", 250), ("demuxer-cache-time", 1000), ("cache-buffering-state", 250)];
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

/// What runs mpv: its own process, or (macOS) libmpv inside the app.
enum Engine {
    #[cfg_attr(target_os = "macos", allow(dead_code))]
    Process(Child),
    #[cfg(target_os = "macos")]
    InApp(mac::Player),
}

impl Engine {
    fn alive(&mut self) -> bool {
        match self {
            Engine::Process(child) => matches!(child.try_wait(), Ok(None)),
            #[cfg(target_os = "macos")]
            Engine::InApp(_) => true,
        }
    }

    fn kill(self) {
        match self {
            Engine::Process(mut child) => {
                let _ = child.kill();
                let _ = child.wait();
            }
            #[cfg(target_os = "macos")]
            Engine::InApp(player) => drop(player),
        }
    }
}

struct Conn {
    engine: Engine,
    writer: WriteHalf<IpcStream>,
    pending: Pending,
    /// Set before an intentional kill so the reader doesn't report a crash.
    quiet: Arc<AtomicBool>,
    /// Set by the reader when the IPC connection ends.
    closed: Arc<AtomicBool>,
}

/// An autocrop run's number and the channel its observed properties go to.
type CropSink = (u64, mpsc::UnboundedSender<(u64, Value)>);

#[derive(Default)]
pub struct Mpv {
    conn: Mutex<Option<Conn>>,
    next_id: AtomicU64,
    /// Bumped on every load/stop; an idle-shutdown timer only fires if it's unchanged.
    idle_gen: AtomicU64,
    /// What mpv is currently tuned to, so `mpv_tune` only sends changes:
    /// re-setting `hwdec` to the same value can still reinitialise decoding.
    tuned: StdMutex<Tune>,
    /// Bumped on every `mpv_load`, so autocrop measures each load afresh
    /// (the same URL played again included).
    loads: AtomicU64,
    /// Bumped each time an autocrop loop starts; an older loop sees it and
    /// stops, so switching autocrop off and on quickly can't leave two running.
    autocrop_run: AtomicU64,
    /// Where the reader sends autocrop's observed properties: the running
    /// task's number and channel ([`CROP_OBSERVE_BASE`]).
    crop_events: StdMutex<Option<CropSink>>,
}

/// The mpv executable's file name here.
const MPV_EXE: &str = if cfg!(windows) { "mpv.exe" } else { "mpv" };

/// mpv: next to our binary (bundled), on PATH, or a standard install.
#[cfg_attr(target_os = "macos", allow(dead_code))]
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

/// The fonts bundled for subtitles (tauri.conf.json `bundle.resources`):
/// in the app's resources, or next to the binary in a dev build.
fn bundled_fonts(app: &AppHandle) -> Option<PathBuf> {
    let exe_dir = std::env::current_exe().ok().and_then(|e| e.parent().map(PathBuf::from));
    [app.path().resource_dir().ok(), exe_dir]
        .into_iter()
        .flatten()
        .map(|d| d.join("fonts"))
        .find(|d| d.join("OpenDyslexic-Regular.otf").is_file())
}

/// libmpv on macOS: bundled in the app, or from Homebrew / MacPorts
/// (`brew install mpv` installs it alongside the mpv command).
#[cfg(target_os = "macos")]
pub fn mpv_library() -> Option<PathBuf> {
    const LIB: &str = "libmpv.2.dylib";
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(dir) = std::env::current_exe().ok().and_then(|e| e.parent().map(PathBuf::from)) {
        candidates.push(dir.join("../Frameworks").join(LIB));
        candidates.push(dir.join(LIB));
    }
    for prefix in ["/opt/homebrew/lib", "/usr/local/lib", "/opt/local/lib"] {
        candidates.push(PathBuf::from(prefix).join(LIB));
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// libmpv inside the app on macOS; the drawing side lives in `macos/mpv_view.m`.
#[cfg(target_os = "macos")]
mod mac {
    use std::ffi::{c_char, c_int, c_void, CStr, CString};
    use std::path::Path;

    extern "C" {
        fn polar_mpv_create(
            libpath: *const c_char,
            nswindow: *mut c_void,
            keys: *const *const c_char,
            vals: *const *const c_char,
            n: c_int,
            err: *mut c_char,
            errlen: usize,
        ) -> *mut c_void;
        fn polar_mpv_set_visible(player: *mut c_void, visible: c_int);
        fn polar_mpv_destroy(player: *mut c_void);
    }

    pub struct Player(*mut c_void);

    // The pointer is only ever used through the functions above, which do
    // their AppKit work on the main thread themselves.
    unsafe impl Send for Player {}

    impl Player {
        /// Start mpv with `options` (name, value) and attach its video to the
        /// window at `nswindow`. Blocks while the main thread sets it up.
        pub fn start(lib: &Path, nswindow: usize, options: &[(String, String)]) -> Result<Self, String> {
            let c = |s: &str| CString::new(s).map_err(|e| e.to_string());
            let lib = c(&lib.to_string_lossy())?;
            let keys = options.iter().map(|(k, _)| c(k)).collect::<Result<Vec<_>, _>>()?;
            let vals = options.iter().map(|(_, v)| c(v)).collect::<Result<Vec<_>, _>>()?;
            let key_ptrs: Vec<*const c_char> = keys.iter().map(|k| k.as_ptr()).collect();
            let val_ptrs: Vec<*const c_char> = vals.iter().map(|v| v.as_ptr()).collect();
            let mut err = [0 as c_char; 512];
            let ptr = unsafe {
                polar_mpv_create(
                    lib.as_ptr(),
                    nswindow as *mut c_void,
                    key_ptrs.as_ptr(),
                    val_ptrs.as_ptr(),
                    options.len() as c_int,
                    err.as_mut_ptr(),
                    err.len(),
                )
            };
            if ptr.is_null() {
                let msg = unsafe { CStr::from_ptr(err.as_ptr()) }.to_string_lossy().into_owned();
                return Err(if msg.is_empty() { "mpv couldn't start".into() } else { msg });
            }
            Ok(Self(ptr))
        }

        pub fn set_visible(&self, visible: bool) {
            unsafe { polar_mpv_set_visible(self.0, visible as c_int) }
        }
    }

    impl Drop for Player {
        fn drop(&mut self) {
            unsafe { polar_mpv_destroy(self.0) }
        }
    }
}

/// The native view mpv draws into (`--wid`).
#[cfg_attr(target_os = "macos", allow(dead_code))]
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

#[cfg(not(target_os = "macos"))]
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
            if !conn.closed.load(Ordering::Relaxed) && conn.engine.alive() {
                return Ok(());
            }
        }
        if let Some(stale) = guard.take() {
            stale.quiet.store(true, Ordering::Relaxed);
            stale.engine.kill();
        }

        let pipe = ipc::endpoint();
        let shots = std::env::temp_dir().join("polar-mpv");
        let _ = std::fs::create_dir_all(&shots);
        // Compiled shaders persist here, so the first frame after an app
        // restart doesn't wait on shader compilation.
        let shader_cache = app.path().app_cache_dir().unwrap_or_else(|_| shots.clone()).join("mpv-shaders");
        let _ = std::fs::create_dir_all(&shader_cache);

        let mut base: Vec<String> = vec![
            format!("--input-ipc-server={pipe}"),
            "--profile=libmpv".into(), // no OSC/OSD/default key bindings — our UI does that
            // Ignore a user's own mpv.conf/scripts: heavy shaders or
            // interpolation from a desktop setup don't belong in the embed.
            "--config=no".into(),
            "--idle=yes".into(),
            "--keep-open=yes".into(),
            "--force-window=yes".into(),
            "--hwdec=auto-safe".into(), // d3d11va / videotoolbox: decoded frames stay on the GPU
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
        // Fonts the app ships for subtitles (OpenDyslexic): mpv otherwise
        // only finds the ones installed on the system.
        if let Some(fonts) = bundled_fonts(app) {
            base.push(format!("--sub-fonts-dir={}", fonts.display()));
        }
        let (engine, client) = start_engine(window, base, &pipe).await?;
        let (reader, writer) = tokio::io::split(client);
        let pending: Pending = Arc::default();
        let quiet = Arc::new(AtomicBool::new(false));
        let closed = Arc::new(AtomicBool::new(false));
        tokio::spawn(read_loop(app.clone(), BufReader::new(reader), pending.clone(), quiet.clone(), closed.clone()));
        *guard = Some(Conn { engine, writer, pending, quiet, closed });
        // A fresh mpv starts from the launch arguments above.
        *self.tuned.locked() = Tune::default();
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
            conn.pending.locked().insert(id, tx);
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
            if let Some(conn) = guard.take() {
                conn.quiet.store(true, Ordering::Relaxed);
                conn.engine.kill();
            }
        }
    }

    /// Show or hide the video layer (macOS, where it's ours to manage; on
    /// Windows mpv's child window simply sits under the page).
    async fn set_visible(&self, visible: bool) {
        #[cfg(target_os = "macos")]
        if let Some(Conn { engine: Engine::InApp(player), .. }) = self.conn.lock().await.as_ref() {
            player.set_visible(visible);
        }
        #[cfg(not(target_os = "macos"))]
        let _ = visible;
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
            if let Some(conn) = guard.take() {
                conn.quiet.store(true, Ordering::Relaxed);
                conn.engine.kill();
            }
        });
    }
}

/// Start mpv for `window` with `base` options and connect to its IPC.
#[cfg(not(target_os = "macos"))]
async fn start_engine(
    window: &WebviewWindow,
    mut base: Vec<String>,
    pipe: &str,
) -> Result<(Engine, IpcStream), String> {
    let bin = mpv_binary().ok_or("mpv isn't installed")?;
    base.push(format!("--wid={}", window_id(window)?));
    base.push("--vo=gpu-next".into());
    base.extend(gpu_args());
    let (child, client) = match launch(&bin, &base, true, pipe).await? {
        Some(ok) => ok,
        // Exited during startup: most likely an older mpv that rejects
        // a newer option.
        None => launch(&bin, &base, false, pipe).await?.ok_or("mpv exited during startup")?,
    };
    Ok((Engine::Process(child), client))
}

/// macOS: libmpv in-process, drawing through its render API (`vo=libmpv`).
#[cfg(target_os = "macos")]
async fn start_engine(window: &WebviewWindow, base: Vec<String>, pipe: &str) -> Result<(Engine, IpcStream), String> {
    let lib = mpv_library().ok_or("mpv isn't installed")?;
    let nswindow = window.ns_window().map_err(|e| e.to_string())? as usize;
    // "--name=value" → (name, value). An option this libmpv doesn't know is
    // only logged, so the newer ones can always go in.
    let options: Vec<(String, String)> = base
        .iter()
        .map(String::as_str)
        .chain(MODERN_ARGS.iter().copied())
        .chain(["--vo=libmpv"])
        .filter_map(|a| a.strip_prefix("--")?.split_once('='))
        .map(|(k, v)| (k.to_owned(), v.to_owned()))
        .collect();
    let player = tokio::task::spawn_blocking(move || mac::Player::start(&lib, nswindow, &options))
        .await
        .map_err(|e| e.to_string())??;
    // The IPC server is up once mpv_initialize has returned, but give it a moment.
    let started = Instant::now();
    loop {
        match ipc::connect(pipe).await {
            Ok(client) => return Ok((Engine::InApp(player), client)),
            Err(_) if started.elapsed() < Duration::from_secs(5) => tokio::time::sleep(Duration::from_millis(15)).await,
            Err(e) => return Err(format!("mpv didn't open its control socket: {e}")),
        }
    }
}

/// Spawn mpv and connect to its IPC pipe. `Ok(None)` means mpv exited before
/// the pipe appeared (only reported when `modern` is set, so the caller can
/// retry without the newer options).
#[cfg(not(target_os = "macos"))]
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
    let mut child = cmd.spawn().map_err(|e| {
        tracing::error!("couldn't start mpv: {e}");
        format!("couldn't start mpv: {e}")
    })?;

    // The pipe appears once mpv has initialised.
    let started = Instant::now();
    loop {
        match ipc::connect(pipe).await {
            Ok(c) => return Ok(Some((child, c))),
            Err(_) if modern && matches!(child.try_wait(), Ok(Some(_))) => return Ok(None),
            Err(_) if started.elapsed() < Duration::from_secs(8) => tokio::time::sleep(Duration::from_millis(15)).await,
            Err(e) => {
                let _ = child.kill();
                tracing::error!("mpv didn't open its control pipe: {e}");
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
    closed: Arc<AtomicBool>,
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
            if let Some(tx) = pending.locked().remove(&id) {
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
                if let Some(id) = msg.get("id").and_then(Value::as_u64).filter(|id| *id >= CROP_OBSERVE_BASE) {
                    if let Some((_, tx)) = app.state::<AppState>().mpv.crop_events.locked().as_ref() {
                        let _ = tx.send((id, msg.get("data").cloned().unwrap_or(Value::Null)));
                    }
                    continue;
                }
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
    closed.store(true, Ordering::Relaxed);
    if !quiet.load(Ordering::Relaxed) {
        let _ = app.emit("mpv://event", json!({ "event": "shutdown" }));
    }
}
