//! libmpv inside the app on Android.
//!
//! The APK carries libmpv and FFmpeg as shared libraries (built in CI as `mpv-android` builds
//! them, docs/plan-mobile.md §7). They're loaded at runtime, so a build without them still runs
//! and plays through the web view's `<video>` ([`available`] is false then).
//!
//! mpv draws into a `SurfaceView` that `MainActivity.kt` puts behind the transparent web view.
//! The view reports its surface here through the `MpvSurface` JNI functions at the end of this
//! file; mpv gets it as `wid` while it runs, and loses it (video off, `vo=null`) while the app
//! is in the background and the surface is gone. Commands and properties go through the same
//! IPC socket as on the other systems.

use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use jni::objects::{GlobalRef, JObject};
use jni::sys::jint;
use jni::JNIEnv;

use crate::locks::Locked;

/// mpv's video output and its Android drawing context.
const VO: &str = "gpu";

type MpvHandle = *mut c_void;

type Create = unsafe extern "C" fn() -> MpvHandle;
type Initialize = unsafe extern "C" fn(MpvHandle) -> c_int;
type Destroy = unsafe extern "C" fn(MpvHandle);
type SetOption = unsafe extern "C" fn(MpvHandle, *const c_char, c_int, *mut c_void) -> c_int;
type SetString = unsafe extern "C" fn(MpvHandle, *const c_char, *const c_char) -> c_int;
type ErrorString = unsafe extern "C" fn(c_int) -> *const c_char;

/// The libmpv functions used here (`mpv/client.h`).
struct Api {
    create: Create,
    initialize: Initialize,
    terminate_destroy: Destroy,
    set_option: SetOption,
    set_option_string: SetString,
    set_property_string: SetString,
    error_string: ErrorString,
}

const MPV_FORMAT_INT64: c_int = 4;

fn dlerror() -> String {
    let e = unsafe { libc::dlerror() };
    if e.is_null() {
        "unknown error".into()
    } else {
        unsafe { CStr::from_ptr(e) }.to_string_lossy().into_owned()
    }
}

/// `dlopen` a library from the APK by file name; the system linker finds it in the app's
/// native library folder.
fn open(name: &str) -> Result<*mut c_void, String> {
    let c = CString::new(name).map_err(|e| e.to_string())?;
    let lib = unsafe { libc::dlopen(c.as_ptr(), libc::RTLD_NOW) };
    if lib.is_null() {
        Err(format!("{name}: {}", dlerror()))
    } else {
        Ok(lib)
    }
}

fn symbol(lib: *mut c_void, name: &str) -> Option<*mut c_void> {
    let c = CString::new(name).ok()?;
    let sym = unsafe { libc::dlsym(lib, c.as_ptr()) };
    (!sym.is_null()).then_some(sym)
}

/// libmpv, loaded once. FFmpeg is handed the Java VM and the app's context first, which its
/// MediaCodec decoders need (`--hwdec=mediacodec`).
fn api() -> Result<&'static Api, String> {
    static API: OnceLock<Result<Api, String>> = OnceLock::new();
    API.get_or_init(|| {
        let mpv = open("libmpv.so")?;
        macro_rules! sym {
            ($name:literal, $ty:ty) => {
                // SAFETY: the symbol is the libmpv function of that name, with the signature in client.h.
                unsafe {
                    std::mem::transmute::<*mut c_void, $ty>(
                        symbol(mpv, $name).ok_or_else(|| format!("libmpv has no {}", $name))?,
                    )
                }
            };
        }
        let api = Api {
            create: sym!("mpv_create", Create),
            initialize: sym!("mpv_initialize", Initialize),
            terminate_destroy: sym!("mpv_terminate_destroy", Destroy),
            set_option: sym!("mpv_set_option", SetOption),
            set_option_string: sym!("mpv_set_option_string", SetString),
            set_property_string: sym!("mpv_set_property_string", SetString),
            error_string: sym!("mpv_error_string", ErrorString),
        };
        hand_jvm_to_ffmpeg();
        Ok(api)
    })
    .as_ref()
    .map_err(Clone::clone)
}

/// `av_jni_set_java_vm` and (FFmpeg 7 and later) `av_jni_set_android_app_ctx`, with the VM
/// and application context Tauri's activity recorded in `ndk_context`.
fn hand_jvm_to_ffmpeg() {
    let Ok(avcodec) = open("libavcodec.so") else {
        tracing::warn!("libavcodec not found: hardware decoding off");
        return;
    };
    let ctx = ndk_context::android_context();
    type SetPtr = unsafe extern "C" fn(*mut c_void, *mut c_void) -> c_int;
    if let Some(f) = symbol(avcodec, "av_jni_set_java_vm") {
        // SAFETY: int av_jni_set_java_vm(void *vm, void *log_ctx), libavcodec/jni.h.
        unsafe { std::mem::transmute::<*mut c_void, SetPtr>(f)(ctx.vm(), std::ptr::null_mut()) };
    }
    if let Some(f) = symbol(avcodec, "av_jni_set_android_app_ctx") {
        // SAFETY: int av_jni_set_android_app_ctx(void *app_ctx, void *log_ctx), libavcodec/jni.h.
        unsafe { std::mem::transmute::<*mut c_void, SetPtr>(f)(ctx.context(), std::ptr::null_mut()) };
    }
}

/// Whether this APK carries libmpv.
pub fn available() -> bool {
    api().is_ok()
}

/// Load libmpv now, off the main thread, so the player doesn't wait for it and a library that
/// can't load shows in the log at start.
pub fn preload() {
    std::thread::spawn(|| match api() {
        Ok(_) => tracing::info!("libmpv loaded"),
        Err(e) => tracing::info!("no libmpv, the player uses the web view's video: {e}"),
    });
}

/// The surface the `SurfaceView` currently has, and the running mpv. One lock for both, so a
/// surface is never released while mpv is still being given it or still draws into it.
struct Shared {
    surface: Option<Surface>,
    mpv: Option<MpvHandle>,
}

struct Surface {
    view: GlobalRef,
    width: i32,
    height: i32,
}

// SAFETY: the handle is only used through libmpv's client API, which is thread-safe.
unsafe impl Send for Shared {}

static SHARED: Mutex<Shared> = Mutex::new(Shared { surface: None, mpv: None });

fn cstr(s: &str) -> CString {
    CString::new(s.replace('\0', "")).unwrap_or_default()
}

fn set_property(api: &Api, mpv: MpvHandle, name: &str, value: &str) {
    let r = unsafe { (api.set_property_string)(mpv, cstr(name).as_ptr(), cstr(value).as_ptr()) };
    if r < 0 {
        let e = unsafe { CStr::from_ptr((api.error_string)(r)) }.to_string_lossy();
        tracing::warn!("mpv: setting {name}: {e}");
    }
}

/// Give mpv `surface` to draw into (or none: `wid` 0).
fn set_wid(api: &Api, mpv: MpvHandle, surface: Option<&Surface>) {
    let mut wid: i64 = surface.map_or(0, |s| s.view.as_obj().as_raw() as i64);
    unsafe { (api.set_option)(mpv, cstr("wid").as_ptr(), MPV_FORMAT_INT64, (&mut wid as *mut i64).cast()) };
}

fn attach(api: &Api, mpv: MpvHandle, surface: &Surface) {
    set_wid(api, mpv, Some(surface));
    set_property(api, mpv, "android-surface-size", &format!("{}x{}", surface.width, surface.height));
    set_property(api, mpv, "force-window", "yes");
    set_property(api, mpv, "vo", VO);
}

/// The running libmpv.
pub struct Player(MpvHandle);

// SAFETY: as for `Shared`.
unsafe impl Send for Player {}

impl Player {
    /// Create and start mpv with `options` (name, value), drawing into the current surface if
    /// there is one. Fonts and certificates are set up in `config_dir` first.
    pub fn start(config_dir: &Path, options: &[(String, String)]) -> Result<Self, String> {
        let api = api()?;
        prepare_config(config_dir);
        let mut shared = SHARED.locked();
        if shared.mpv.is_some() {
            return Err("mpv is already running".into());
        }
        // mpv parses numbers with the C locale.
        unsafe { libc::setlocale(libc::LC_NUMERIC, c"C".as_ptr()) };
        let mpv = unsafe { (api.create)() };
        if mpv.is_null() {
            return Err("mpv_create failed".into());
        }
        let config = config_dir.to_string_lossy();
        let platform = [
            // Only this app's own folder: fonts.conf, nothing a user put there.
            ("config", "yes"),
            ("config-dir", config.as_ref()),
            ("gpu-context", "android"),
            ("opengl-es", "yes"),
            ("ao", "audiotrack,opensles"),
            ("audio-set-media-role", "yes"),
            ("tls-verify", "yes"),
            ("sub-font", "Roboto"),
        ];
        let ca = config_dir.join(CA_FILE);
        let ca = ca.to_string_lossy();
        let pairs = options
            .iter()
            .map(|(k, v)| (k.as_str(), v.as_str()))
            .chain(platform)
            .chain(Path::new(ca.as_ref()).is_file().then_some(("tls-ca-file", ca.as_ref())));
        for (k, v) in pairs {
            unsafe { (api.set_option_string)(mpv, cstr(k).as_ptr(), cstr(v).as_ptr()) };
        }
        match &shared.surface {
            Some(surface) => {
                set_wid(api, mpv, Some(surface));
                let size = format!("{}x{}", surface.width, surface.height);
                unsafe { (api.set_option_string)(mpv, c"android-surface-size".as_ptr(), cstr(&size).as_ptr()) };
                unsafe { (api.set_option_string)(mpv, c"vo".as_ptr(), cstr(VO).as_ptr()) };
            }
            // In the background: no picture until the surface comes back.
            None => unsafe {
                (api.set_option_string)(mpv, c"vo".as_ptr(), c"null".as_ptr());
                (api.set_option_string)(mpv, c"force-window".as_ptr(), c"no".as_ptr());
            },
        }
        let r = unsafe { (api.initialize)(mpv) };
        if r < 0 {
            let e = unsafe { CStr::from_ptr((api.error_string)(r)) }.to_string_lossy().into_owned();
            unsafe { (api.terminate_destroy)(mpv) };
            return Err(format!("mpv_initialize: {e}"));
        }
        shared.mpv = Some(mpv);
        Ok(Self(mpv))
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        let Ok(api) = api() else { return };
        // Held while mpv shuts down, so the surface outlives its last frame.
        let mut shared = SHARED.locked();
        if shared.mpv == Some(self.0) {
            shared.mpv = None;
        }
        unsafe { (api.terminate_destroy)(self.0) };
    }
}

/// The certificate bundle mbedTLS reads (it can't use Android's certificate store).
const CA_FILE: &str = "cacert.pem";

/// Android's trusted certificates, one PEM file each (followed by a text dump), as one bundle.
const SYSTEM_CERTS: &str = "/system/etc/security/cacerts";

/// Write `fonts.conf` (fontconfig finds Android's fonts through it) and the certificate bundle
/// into mpv's config folder. Failures only cost subtitles their font or HTTPS its checks, so
/// they're logged and playback goes on.
fn prepare_config(dir: &Path) {
    if let Err(e) = std::fs::create_dir_all(dir) {
        tracing::warn!("mpv config folder: {e}");
        return;
    }
    let cache = dir.join("fontconfig-cache");
    if let Err(e) = std::fs::write(dir.join("fonts.conf"), fonts_conf(&cache)) {
        tracing::warn!("mpv fonts.conf: {e}");
    }
    match polar_player::certs::pem_bundle(Path::new(SYSTEM_CERTS)) {
        Ok(pem) if !pem.is_empty() => {
            if let Err(e) = std::fs::write(dir.join(CA_FILE), pem) {
                tracing::warn!("mpv certificates: {e}");
            }
        }
        Ok(_) => tracing::warn!("no system certificates found"),
        Err(e) => tracing::warn!("system certificates: {e}"),
    }
}

/// fontconfig's settings: Android's font folders and the families it ships for the generic names.
fn fonts_conf(cache: &Path) -> String {
    format!(
        "<?xml version=\"1.0\"?>\n<fontconfig>\n\
         <dir>/system/fonts</dir>\n<dir>/product/fonts</dir>\n\
         <cachedir>{}</cachedir>\n\
         <alias><family>sans-serif</family><prefer><family>Roboto</family><family>Noto Sans</family></prefer></alias>\n\
         <alias><family>serif</family><prefer><family>Noto Serif</family></prefer></alias>\n\
         <alias><family>monospace</family><prefer><family>Droid Sans Mono</family></prefer></alias>\n\
         </fontconfig>\n",
        cache.display()
    )
}

// The `MpvSurface` object in MainActivity.kt calls these from the UI thread.

#[no_mangle]
pub extern "system" fn Java_app_getpolar_desktop_MpvSurface_created<'a>(
    env: JNIEnv<'a>,
    _this: JObject<'a>,
    surface: JObject<'a>,
    width: jint,
    height: jint,
) {
    let view = match env.new_global_ref(surface) {
        Ok(view) => view,
        Err(e) => return tracing::warn!("mpv surface: {e}"),
    };
    let mut guard = SHARED.locked();
    let shared = &mut *guard;
    let surface = shared.surface.insert(Surface { view, width, height });
    if let (Some(mpv), Ok(api)) = (shared.mpv, api()) {
        attach(api, mpv, surface);
    }
}

#[no_mangle]
pub extern "system" fn Java_app_getpolar_desktop_MpvSurface_changed<'a>(
    _env: JNIEnv<'a>,
    _this: JObject<'a>,
    width: jint,
    height: jint,
) {
    let mut guard = SHARED.locked();
    let shared = &mut *guard;
    let Some(surface) = shared.surface.as_mut() else { return };
    surface.width = width;
    surface.height = height;
    if let (Some(mpv), Ok(api)) = (shared.mpv, api()) {
        set_property(api, mpv, "android-surface-size", &format!("{width}x{height}"));
    }
}

/// The surface is going away (app in the background): mpv must stop drawing into it before
/// this returns.
#[no_mangle]
pub extern "system" fn Java_app_getpolar_desktop_MpvSurface_destroyed<'a>(_env: JNIEnv<'a>, _this: JObject<'a>) {
    let mut shared = SHARED.locked();
    if let (Some(mpv), Ok(api)) = (shared.mpv, api()) {
        set_property(api, mpv, "vo", "null");
        set_property(api, mpv, "force-window", "no");
        set_wid(api, mpv, None);
    }
    shared.surface = None;
}
