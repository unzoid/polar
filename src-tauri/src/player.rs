//! Embedded mpv playback engine.
//!
//! WebView2's `<video>` can't decode much of what p2ps carry: HEVC in MKV,
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

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::process::Child;
#[cfg(not(target_os = "macos"))]
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, WriteHalf};
use tokio::sync::{mpsc, oneshot, Mutex};

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
    crop_events: StdMutex<Option<(u64, mpsc::UnboundedSender<(u64, Value)>)>>,
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
        let shader_cache = app
            .path()
            .app_cache_dir()
            .unwrap_or_else(|_| shots.clone())
            .join("mpv-shaders");
        let _ = std::fs::create_dir_all(&shader_cache);

        let base: Vec<String> = vec![
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
        let (engine, client) = start_engine(window, base, &pipe).await?;
        let (reader, writer) = tokio::io::split(client);
        let pending: Pending = Arc::default();
        let quiet = Arc::new(AtomicBool::new(false));
        let closed = Arc::new(AtomicBool::new(false));
        tokio::spawn(read_loop(app.clone(), BufReader::new(reader), pending.clone(), quiet.clone(), closed.clone()));
        *guard = Some(Conn { engine, writer, pending, quiet, closed });
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
async fn start_engine(window: &WebviewWindow, mut base: Vec<String>, pipe: &str) -> Result<(Engine, IpcStream), String> {
    let bin = mpv_binary().ok_or("mpv isn't installed")?;
    base.push(format!("--wid={}", window_id(window)?));
    base.push("--vo=gpu-next".into());
    base.extend(gpu_args());
    let (child, client) = match launch(&bin, &base, true, pipe).await? {
        Some(ok) => ok,
        // Exited during startup: most likely an older mpv that rejects
        // a newer option.
        None => launch(&bin, &base, false, pipe)
            .await?
            .ok_or("mpv exited during startup")?,
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
                if let Some(id) = msg.get("id").and_then(Value::as_u64).filter(|id| *id >= CROP_OBSERVE_BASE) {
                    if let Some((_, tx)) = app.state::<AppState>().mpv.crop_events.lock().unwrap().as_ref() {
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

// --- Commands --------------------------------------------------------------

#[tauri::command]
pub fn mpv_available() -> bool {
    #[cfg(target_os = "macos")]
    return mpv_library().is_some();
    #[cfg(not(target_os = "macos"))]
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
    // A new file is measured afresh (autocrop): drop the last one's crop.
    state.mpv.loads.fetch_add(1, Ordering::SeqCst);
    state.mpv.request(json!(["set_property", "video-zoom", 0])).await.ok();
    state.mpv.request(json!(["loadfile", url, "replace", -1, options])).await?;
    state.mpv.request(json!(["set_property", "pause", false])).await?;
    state.mpv.set_visible(true).await;
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
    /// Crop black bars burnt into the picture (a 2.39:1 film inside a 16:9
    /// file), so it fills a wide screen. See [`autocrop`].
    #[serde(default)]
    pub autocrop: bool,
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
        Self { dialogue_boost: false, volume_leveling: false, hwdec: true, deband: false, buffer: BufferSize::Normal, autocrop: false }
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

    /// Hardware decoding. Measuring the bars needs the decoded frames in
    /// memory, so with autocrop on they're copied back from the GPU.
    fn hwdec_mode(&self) -> &'static str {
        match (self.hwdec, self.autocrop) {
            (false, _) => "no",
            (true, false) => "auto-safe",
            (true, true) => "auto-copy-safe",
        }
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
pub async fn mpv_tune(app: AppHandle, state: State<'_, AppState>, tune: Tune) -> Result<(), String> {
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
    if was.hwdec_mode() != tune.hwdec_mode() {
        mpv.request(json!(["set_property", "hwdec", tune.hwdec_mode()])).await?;
    }
    if was.autocrop != tune.autocrop {
        if tune.autocrop {
            mpv.request(json!(["vf", "add", CROPDETECT])).await?;
        } else {
            mpv.request(json!(["vf", "remove", "@autocrop"])).await?;
            mpv.request(json!(["set_property", "video-zoom", 0])).await?;
        }
        // Dialogue placed and sized by the window rather than the (zoomed)
        // picture, so cropping never moves, grows or stretches it. See
        // [`zoom_for`]. Positioned signs still follow the picture.
        mpv.request(json!(["set_property", "sub-ass-force-margins", tune.autocrop])).await?;
        mpv.request(json!(["set_property", "sub-ass-scale-with-window", tune.autocrop])).await?;
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
    if tune.autocrop && !was.autocrop {
        let run = mpv.autocrop_run.fetch_add(1, Ordering::SeqCst) + 1;
        tauri::async_runtime::spawn(autocrop(app, run));
    }
    Ok(())
}

/// Finds the picture's edges in each frame (`reset=1`: no memory between
/// frames; [`CropTracker`] does the remembering): rows and columns whose
/// average is above `limit` (a fraction of the signal range) are picture.
/// It needs decoded frames in memory, hence `Tune::hwdec_mode`'s copy-back.
const CROPDETECT: &str = "@autocrop:lavfi=[cropdetect=limit=0.09:round=2:reset=1]";

/// The same for HDR (PQ or HLG). Dark picture sits much nearer black in an
/// HDR signal, so at 0.09 the dim rows next to the bars of a dark shot read
/// as bar, by different amounts at top and bottom, and the uneven bars were
/// rightly not believed. Measured on a 4K HDR10 episode: 0.09 gave bars of
/// 306 and 416 px, 0.07 gave 264 and 282 (the real ones are ~264), while a
/// dark full-frame shot still read as full frame.
const CROPDETECT_HDR: &str = "@autocrop:lavfi=[cropdetect=limit=0.07:round=2:reset=1]";

/// The cropdetect filter for video with this `video-params/gamma`.
fn cropdetect_for(gamma: Option<&str>) -> &'static str {
    match gamma {
        Some("pq" | "hlg") => CROPDETECT_HDR,
        _ => CROPDETECT,
    }
}

/// Property-change ids from here up are autocrop's own observations: the
/// reader hands them to the running [`autocrop`] task instead of the UI.
const CROP_OBSERVE_BASE: u64 = 1 << 32;

/// What [`autocrop`] needs to know about the video and the window.
#[derive(Debug, Clone, Copy)]
struct CropGeometry {
    /// Frame size in video pixels, and as displayed (non-square pixels).
    size: (i64, i64),
    display: (i64, i64),
    window: (i64, i64),
    /// The cropdetect filter this video needs ([`cropdetect_for`]).
    filter: &'static str,
}

async fn crop_geometry(mpv: &Mpv) -> Option<CropGeometry> {
    let params = mpv.request(json!(["get_property", "video-params"])).await.ok()?;
    let osd = mpv.request(json!(["get_property", "osd-dimensions"])).await.ok()?;
    let int = |v: &Value, k: &str| v.get(k).and_then(Value::as_i64).filter(|n| *n > 0);
    Some(CropGeometry {
        size: (int(&params, "w")?, int(&params, "h")?),
        display: (int(&params, "dw")?, int(&params, "dh")?),
        window: (int(&osd, "w")?, int(&osd, "h")?),
        filter: cropdetect_for(params.get("gamma").and_then(Value::as_str)),
    })
}

/// cropdetect's reading from `vf-metadata/autocrop`.
fn cropdetect_reading(meta: &Value) -> Option<Rect> {
    let num = |k: &str| meta.get(format!("lavfi.cropdetect.{k}")).and_then(Value::as_str).and_then(|v| v.parse::<i64>().ok());
    Some(Rect { w: num("w")?, h: num("h")?, x: num("x")?, y: num("y")? })
}

/// While autocrop is on: mpv reports cropdetect's reading whenever it
/// changes, and the playback position once per displayed frame, observed in
/// that order so each frame's reading arrives before its tick. Every frame
/// goes to [`CropTracker`] and the zoom follows at once. Readings run a
/// frame ahead of the screen (mpv filters a frame before showing it), so a
/// switch the tracker believes straight away lands on the cut. While paused
/// no frames come and nothing changes, except keeping the zoom right for
/// the window.
async fn autocrop(app: AppHandle, run: u64) {
    let meta_id = CROP_OBSERVE_BASE + run * 2;
    let frame_id = meta_id + 1;
    let (tx, mut rx) = mpsc::unbounded_channel();
    {
        let state = app.state::<AppState>();
        *state.mpv.crop_events.lock().unwrap() = Some((run, tx));
        let _ = state.mpv.request(json!(["observe_property", meta_id, "vf-metadata/autocrop"])).await;
        let _ = state.mpv.request(json!(["observe_property", frame_id, "time-pos"])).await;
    }
    let mut tracker = CropTracker::default();
    let mut reading: Option<Rect> = None;
    let mut geometry: Option<(CropGeometry, Instant)> = None;
    let mut sent: Option<(u64, f64)> = None; // (load, video-zoom) last set on mpv
    let mut filter = CROPDETECT; // what mpv_tune added
    loop {
        let event = tokio::time::timeout(Duration::from_millis(500), rx.recv()).await;
        let state = app.state::<AppState>();
        let mpv = &state.mpv;
        if !mpv.tuned.lock().unwrap().autocrop || mpv.autocrop_run.load(Ordering::SeqCst) != run {
            break;
        }
        let frame = match event {
            Ok(None) => break, // a newer run took over
            Ok(Some((id, data))) if id == meta_id => {
                reading = cropdetect_reading(&data);
                continue;
            }
            Ok(Some((id, data))) if id == frame_id => data.is_number(),
            Ok(Some(_)) => continue,
            Err(_) => false, // nothing for 500 ms: paused
        };
        let load = mpv.loads.load(Ordering::SeqCst);
        // The window changes size (fullscreen) and the video rarely does:
        // re-read them 4 times a second, and on every idle tick.
        if !frame || geometry.is_none_or(|(_, at)| at.elapsed() >= Duration::from_millis(250)) {
            geometry = crop_geometry(mpv).await.map(|g| (g, Instant::now()));
        }
        let Some((g, _)) = geometry else {
            continue; // between files: nothing to measure
        };
        // HDR and SDR need different thresholds: swap the filter when the video's changes.
        if g.filter != filter {
            if !mpv.tuned.lock().unwrap().autocrop {
                break;
            }
            mpv.request(json!(["vf", "remove", "@autocrop"])).await.ok();
            if mpv.request(json!(["vf", "add", g.filter])).await.is_ok() {
                filter = g.filter;
                reading = None;
            }
            continue;
        }
        if frame {
            tracker.update(load, g.size, g.display, reading);
        }
        let zoom = zoom_for(tracker.bars(load), g.size, g.display, g.window);
        if zoom_changed(sent, load, zoom) && mpv.request(json!(["set_property", "video-zoom", zoom])).await.is_ok() {
            sent = Some((load, zoom));
        }
    }
    let state = app.state::<AppState>();
    {
        let mut slot = state.mpv.crop_events.lock().unwrap();
        if slot.as_ref().is_some_and(|(r, _)| *r == run) {
            *slot = None;
        }
    }
    let _ = state.mpv.request(json!(["unobserve_property", meta_id])).await;
    let _ = state.mpv.request(json!(["unobserve_property", frame_id])).await;
}

/// Whether `zoom` is worth sending after `sent`. Like madVR's "disable
/// scaling if image size changes by only 2 lines or less", a size change
/// under 1% isn't worth a visible jump; going back to no zoom always is.
fn zoom_changed(sent: Option<(u64, f64)>, load: u64, zoom: f64) -> bool {
    match sent {
        Some((l, s)) if l == load => {
            if zoom == 0.0 {
                s != 0.0
            } else {
                ((zoom - s) * std::f64::consts::LN_2).abs() >= 0.01
            }
        }
        _ => true,
    }
}

/// The `video-zoom` (log2 of the scale) that makes the picture inside `bars`
/// (each side's thickness: top and bottom, left and right, in video pixels)
/// fill the window as far as its shape allows.
///
/// Zoom rather than `video-crop`: mpv lays ASS subtitles out over the
/// displayed video, and a crop changes that area's shape, which stretches
/// dialogue in any script with `LayoutResX/Y` (most anime releases). A zoom
/// keeps the shape; with `sub-ass-force-margins` and
/// `sub-ass-scale-with-window` dialogue then stays put at its normal size.
fn zoom_for((v, h): (i64, i64), (w, hgt): (i64, i64), (dw, dh): (i64, i64), (win_w, win_h): (i64, i64)) -> f64 {
    if v <= 0 && h <= 0 {
        return 0.0;
    }
    let (sx, sy) = (dw as f64 / w as f64, dh as f64 / hgt as f64);
    let fit = |pw: f64, ph: f64| (win_w as f64 / pw).min(win_h as f64 / ph);
    let full = fit(dw as f64, dh as f64);
    let picture = fit((w - 2 * h) as f64 * sx, (hgt - 2 * v) as f64 * sy);
    (picture / full).log2().max(0.0)
}

/// A picture area in video pixels, as cropdetect reports it.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Rect {
    w: i64,
    h: i64,
    x: i64,
    y: i64,
}

/// Frames kept to judge the bars by (half a second at 24 fps).
const CROP_HISTORY: usize = 12;
/// Frames bar edges must hold still for before they're cropped: bars this
/// file has shown before, and bars that leave a common picture shape. Any
/// other shape needs [`CROP_HISTORY`].
const KNOWN_FRAMES: usize = 2;
const COMMON_FRAMES: usize = 4;
/// How far apart (pixels) readings of the same bar edge may be. A real bar's
/// edge is crisp and found on the same row every frame; dark picture content
/// fades out at a different row from one frame to the next.
const EDGE_SLACK: i64 = 4;
/// Picture shapes films and shows are made in. Bars that leave one of these
/// are believed sooner than bars that leave an odd shape.
const COMMON_ASPECTS: &[f64] = &[1.33, 1.37, 1.43, 1.5, 1.66, 1.78, 1.85, 1.9, 2.0, 2.2, 2.35, 2.39, 2.4, 2.55, 2.76];

/// Which bars to remove, from cropdetect's per-frame readings, in the spirit
/// of madVR's black bar detection. It changes both ways, quickly, and is
/// careful only where a mistake would cut picture off:
///
///  * Picture showing up where a bar was cropped: un-crop on the first frame
///    when that goes back to full frame or to bars this file has shown (a
///    16:9 shot after a letterboxed one), otherwise after 2 frames, so a
///    stray frame doesn't (subtitles burnt into a bar still do).
///  * Bars appearing or getting thicker: crop once the bar edges have sat on
///    the same rows for [`KNOWN_FRAMES`] if this file has shown those bars
///    before, [`COMMON_FRAMES`] for a common picture shape, and
///    [`CROP_HISTORY`] for an odd one. Opposite bars must be even, as
///    letterboxing is; a dark scene lit on one side isn't a bar. The picture
///    must be at least 40% of the frame.
///  * Black frames (fades) say nothing either way.
///  * Bars thinner than 1% a side aren't worth cropping.
///
/// Each axis is judged on its own, so a dark vignette at the sides doesn't
/// hold up cropping the letterbox.
#[derive(Debug, Default)]
struct CropTracker {
    /// The `Mpv::loads` and frame size these readings belong to.
    load: u64,
    full: (i64, i64),
    /// Bar thickness per frame, `[top, bottom, left, right]`, oldest first.
    recent: VecDeque<[i64; 4]>,
    /// Bars removed now: (top and bottom, left and right).
    shown: (i64, i64),
    /// Bar thicknesses cropped earlier in this load, per axis.
    known: [Vec<i64>; 2],
}

impl CropTracker {
    /// The bars to remove for `load`: none before its first reading.
    fn bars(&self, load: u64) -> (i64, i64) {
        if load == self.load {
            self.shown
        } else {
            (0, 0)
        }
    }

    /// Feed one frame's reading (`None` if cropdetect had nothing).
    /// `display` is the frame's display size, for non-square pixels.
    fn update(&mut self, load: u64, full: (i64, i64), display: (i64, i64), reading: Option<Rect>) {
        if load != self.load || full != self.full {
            *self = CropTracker { load, full, ..Default::default() };
        }
        let (fw, fh) = full;
        // An all-black frame comes back as an empty or inside-out area.
        let Some(r) = reading.filter(|r| r.w > 0 && r.h > 0 && r.x >= 0 && r.y >= 0 && r.x + r.w <= fw && r.y + r.h <= fh) else {
            return;
        };
        if self.recent.len() == CROP_HISTORY {
            self.recent.pop_front();
        }
        self.recent.push_back([r.y, fh - r.y - r.h, r.x, fw - r.x - r.w]);

        let shown = [self.shown.0, self.shown.1];
        let mut next = shown;
        for axis in 0..2 {
            if let Some(thinner) = self.revealed(axis, shown[axis]) {
                next[axis] = thinner;
            } else if let Some(bars) = self.settled(axis, shown, display) {
                next[axis] = bars;
            }
        }
        for axis in 0..2 {
            if next[axis] > shown[axis] && !self.known[axis].iter().any(|k| (k - next[axis]).abs() <= EDGE_SLACK) {
                self.known[axis].push(next[axis]);
            }
        }
        self.shown = (next[0], next[1]);
    }

    /// Picture inside the cropped bars on `axis` (0: top/bottom, 1:
    /// left/right): the bar size that shows it. The newest frame is enough
    /// when it goes back to no bars or to bars this file has shown; anything
    /// else needs the last 2 frames to agree there's picture there.
    fn revealed(&self, axis: usize, shown: i64) -> Option<i64> {
        let dim = if axis == 0 { self.full.1 } else { self.full.0 };
        let mut last = self.recent.iter().rev().map(|r| r[2 * axis].min(r[2 * axis + 1]));
        let newest = last.next().filter(|&t| t < shown - EDGE_SLACK)?;
        let newest = if newest * 100 < dim { 0 } else { newest };
        if newest == 0 || self.known[axis].iter().any(|k| (k - newest).abs() <= EDGE_SLACK) {
            return Some(newest);
        }
        let before = last.next().filter(|&t| t < shown - EDGE_SLACK)?;
        Some(newest.min(before))
    }

    /// A new bar size on `axis` that recent frames agree on, if they've
    /// agreed for long enough to believe it.
    fn settled(&self, axis: usize, shown: [i64; 2], (dw, dh): (i64, i64)) -> Option<i64> {
        let (fw, fh) = self.full;
        let dim = if axis == 0 { fh } else { fw };
        let even = ((dim as f64 * 0.02).round() as i64).max(EDGE_SLACK);
        let edge = |n: usize, side: usize| self.recent.iter().rev().take(n).map(move |r| r[2 * axis + side]);
        // How many of the latest frames the bar edges have held still for.
        let held = [KNOWN_FRAMES, COMMON_FRAMES, CROP_HISTORY]
            .into_iter()
            .take_while(|&n| {
                self.recent.len() >= n
                    && (0..2).all(|side| edge(n, side).max().unwrap_or(0) - edge(n, side).min().unwrap_or(0) <= EDGE_SLACK)
            })
            .last()?;
        let (a, b) = (edge(held, 0).min().unwrap_or(0), edge(held, 1).min().unwrap_or(0));
        if (a - b).abs() > even {
            return None;
        }
        let bars = if a.min(b) * 100 >= dim { a.min(b) } else { 0 };
        if (bars - shown[axis]).abs() <= EDGE_SLACK {
            return None;
        }
        let mut both = shown;
        both[axis] = bars;
        let (pw, ph) = (fw - 2 * both[1], fh - 2 * both[0]);
        if pw * ph * 10 < fw * fh * 4 {
            return None;
        }
        if bars < shown[axis] {
            return Some(bars); // thinner bars: nothing more is cut off
        }
        let shape = (pw as f64 * dw as f64 / fw as f64) / (ph as f64 * dh as f64 / fh as f64);
        let needed = if self.known[axis].iter().any(|k| (k - bars).abs() <= EDGE_SLACK) {
            KNOWN_FRAMES
        } else if COMMON_ASPECTS.iter().any(|c| (shape / c - 1.0).abs() <= 0.02) {
            COMMON_FRAMES
        } else {
            CROP_HISTORY
        };
        (held >= needed).then_some(bars)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tune_builds_fixed_filters() {
        let t = Tune { dialogue_boost: true, volume_leveling: true, hwdec: true, deband: false, buffer: BufferSize::Large, autocrop: false };
        assert!(t.audio_filters().starts_with("lavfi=[pan=stereo") && t.audio_filters().contains("dynaudnorm"));
        let off = Tune { dialogue_boost: false, volume_leveling: false, ..t };
        assert_eq!(off.audio_filters(), "");
        assert_eq!(t.cache(), (300, "768MiB"));
    }

    const HD: (i64, i64) = (1920, 1080);
    /// A 2.40:1 picture letterboxed in 16:9.
    const SCOPE: Rect = Rect { w: 1920, h: 800, x: 0, y: 140 };
    const FULL: Rect = Rect { w: 1920, h: 1080, x: 0, y: 0 };

    /// Feed `readings` (one per frame) to `t` for load 1; the bars after each.
    fn feed(t: &mut CropTracker, readings: &[Option<Rect>]) -> Vec<(i64, i64)> {
        readings
            .iter()
            .map(|r| {
                t.update(1, HD, HD, *r);
                t.bars(1)
            })
            .collect()
    }

    /// cropdetect's `WxH+X+Y`, as mpv reports it.
    fn rect(s: &str) -> Option<Rect> {
        let (w, rest) = s.split_once('x')?;
        let mut n = rest.split('+').map(|v| v.parse::<i64>().ok());
        Some(Rect { w: w.parse().ok()?, h: n.next()??, x: n.next()??, y: n.next()?? })
    }

    #[test]
    fn follows_a_real_clip_frame_by_frame() {
        let frames: Vec<(f64, Option<Rect>)> = include_str!("testdata/autocrop_frames.txt")
            .lines()
            .filter(|l| !l.starts_with('#'))
            .filter_map(|l| {
                let (t, r) = l.split_once(' ')?;
                Some((t.parse().ok()?, rect(r)))
            })
            .collect();
        assert!(frames.len() > 500);
        let mut t = CropTracker::default();
        let shown: Vec<(f64, (i64, i64))> = frames
            .iter()
            .map(|(time, r)| {
                t.update(1, HD, HD, *r);
                (*time, t.bars(1))
            })
            .collect();
        // Only ever the letterbox or nothing: the vignette's sides are never cropped.
        assert!(shown.iter().all(|(_, b)| *b == (0, 0) || *b == (140, 0)), "{shown:?}");
        let at = |from: f64, to: f64| shown.iter().filter(move |(time, _)| *time >= from && *time < to).map(|(_, b)| *b);
        let frame = 1.0 / 24.0;
        // New bars at 3.958 s (the reading for the 4.0 s frame): cropped 4 frames later.
        assert!(at(3.958 + 3.0 * frame + 0.001, 9.95).all(|b| b == (140, 0)), "{shown:?}");
        // Back to full frame at 9.958 s: on that very frame, so it lands on the cut.
        assert!(at(9.958, 13.95).all(|b| b == (0, 0)), "{shown:?}");
        // The dark letterbox: bars seen before, cropped 2 frames after they first show.
        let first = frames.iter().find(|(time, r)| *time > 14.0 && r.is_some_and(|r| r.y == 140 && r.h == 800)).unwrap().0;
        assert!(at(first + frame + 0.001, 19.95).all(|b| b == (140, 0)), "{shown:?}");
        assert!(at(19.958, 99.0).all(|b| b == (0, 0)), "{shown:?}");
    }

    #[test]
    fn finds_the_bars_of_a_dark_hdr_shot() {
        // 4K HDR10, cropdetect at CROPDETECT_HDR's limit, sampled every 100 ms;
        // the letterboxed shot starts at 174.0 s.
        let uhd = (3840, 2160);
        let mut t = CropTracker::default();
        let mut shown = Vec::new();
        for l in include_str!("testdata/autocrop_hdr.txt").lines().filter(|l| !l.starts_with('#')) {
            let Some((time, r)) = l.split_once(' ') else { continue };
            t.update(1, uhd, uhd, rect(r));
            shown.push((time.parse::<f64>().unwrap(), t.bars(1)));
        }
        assert!(shown.iter().filter(|(time, _)| *time < 174.0).all(|(_, b)| *b == (0, 0)));
        let cropped: Vec<_> = shown.iter().filter(|(time, _)| *time >= 175.0).map(|(_, b)| *b).collect();
        assert!(!cropped.is_empty() && cropped.iter().all(|&(v, h)| (262..=268).contains(&v) && h == 0), "{shown:?}");
        assert_eq!(cropdetect_for(Some("pq")), CROPDETECT_HDR);
        assert_eq!(cropdetect_for(Some("hlg")), CROPDETECT_HDR);
        assert_eq!(cropdetect_for(Some("bt.1886")), CROPDETECT);
        assert_eq!(cropdetect_for(None), CROPDETECT);
    }

    #[test]
    fn crops_in_a_few_frames_and_known_bars_sooner() {
        let mut t = CropTracker::default();
        assert_eq!(feed(&mut t, &[Some(FULL); 6]).last(), Some(&(0, 0)));
        assert_eq!(feed(&mut t, &[Some(SCOPE); 3]).last(), Some(&(0, 0)));
        assert_eq!(feed(&mut t, &[Some(SCOPE)]).last(), Some(&(140, 0)), "4 frames");
        assert_eq!(feed(&mut t, &[Some(FULL)]).last(), Some(&(0, 0)), "1 frame back to full");
        assert_eq!(feed(&mut t, &[Some(SCOPE)]).last(), Some(&(0, 0)));
        assert_eq!(feed(&mut t, &[Some(SCOPE)]).last(), Some(&(140, 0)), "the same bars again: 2 frames");
    }

    #[test]
    fn a_flash_in_a_bar_or_black_frames_change_nothing() {
        let mut t = CropTracker::default();
        feed(&mut t, &[Some(SCOPE); 5]);
        let flash = Rect { w: 1920, h: 960, x: 0, y: 60 };
        let black = Rect { w: -1918, h: -1078, x: 1920, y: 1080 };
        let readings = [Some(flash), Some(SCOPE), None, Some(black), Some(black), Some(flash), Some(SCOPE)];
        assert!(feed(&mut t, &readings).iter().all(|b| *b == (140, 0)));
    }

    #[test]
    fn dark_scenes_in_full_frame_need_longer_for_odd_shapes() {
        let mut t = CropTracker::default();
        feed(&mut t, &[Some(FULL); 3]);
        // Dark at top and bottom, evenly, holding still: a 2.13:1 shape, which films aren't made in.
        let dark = Rect { w: 1920, h: 900, x: 0, y: 90 };
        assert!(feed(&mut t, &[Some(dark); 11]).iter().all(|b| *b == (0, 0)));
        assert_eq!(feed(&mut t, &[Some(dark)]).last(), Some(&(90, 0)), "after 1.2 s");
        // Lit on one side only: never bars.
        let lopsided = Rect { w: 1920, h: 900, x: 0, y: 30 };
        let mut t = CropTracker::default();
        assert!(feed(&mut t, &[Some(lopsided); 20]).iter().all(|b| *b == (0, 0)));
    }

    #[test]
    fn subtitles_burnt_into_a_bar_are_shown() {
        let mut t = CropTracker::default();
        feed(&mut t, &[Some(SCOPE); 5]);
        let subtitles = Rect { w: 1920, h: 880, x: 0, y: 140 }; // 60 px of bar left below them
        assert_eq!(feed(&mut t, &[Some(subtitles); 2]).last(), Some(&(60, 0)));
        assert_eq!(feed(&mut t, &[Some(SCOPE); 3]).last(), Some(&(140, 0)), "cropped again once they're gone");
    }

    #[test]
    fn each_load_starts_over() {
        let mut t = CropTracker::default();
        feed(&mut t, &[Some(SCOPE); 5]);
        assert_eq!(t.bars(1), (140, 0));
        assert_eq!(t.bars(2), (0, 0), "a new load shows nothing cropped before its first frame");
        t.update(2, HD, HD, Some(SCOPE));
        assert_eq!(t.bars(2), (0, 0));
        // A different frame size within one load (a new video track) too.
        feed(&mut t, &[Some(SCOPE); 5]);
        t.update(1, (3840, 2160), (3840, 2160), Some(SCOPE));
        assert_eq!(t.bars(1), (0, 0));
    }

    #[test]
    fn zoom_fills_the_window_only_as_far_as_the_picture_allows() {
        let ultrawide = (2000, 837);
        assert_eq!(zoom_for((0, 0), HD, HD, ultrawide), 0.0);
        // A 2.40:1 picture on a 2.39:1 window: limited by the width.
        let z = zoom_for((140, 0), HD, HD, ultrawide);
        assert!((2f64.powf(z) - (2000.0 / 1920.0) / (837.0 / 1080.0)).abs() < 1e-9, "{z}");
        // On a 16:9 window the letterbox already fits: nothing to zoom.
        assert_eq!(zoom_for((140, 0), HD, HD, (1920, 1080)), 0.0);
        // Cropping the sides of a picture that's already pillarboxed changes nothing.
        assert_eq!(zoom_for((0, 240), HD, HD, ultrawide), 0.0);
        // Anamorphic 1440x1080 shown as 1920x1080: same as square pixels.
        assert!((zoom_for((140, 0), (1440, 1080), HD, ultrawide) - z).abs() < 1e-9);
    }

    #[test]
    fn small_zoom_changes_are_skipped() {
        assert!(zoom_changed(None, 1, 0.0));
        assert!(zoom_changed(Some((1, 0.4)), 2, 0.4), "a new load");
        assert!(!zoom_changed(Some((1, 0.4)), 1, 0.405));
        assert!(zoom_changed(Some((1, 0.4)), 1, 0.43));
        assert!(zoom_changed(Some((1, 0.01)), 1, 0.0), "back to none always");
        assert!(!zoom_changed(Some((1, 0.0)), 1, 0.0));
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
    state.mpv.set_visible(false).await;
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
