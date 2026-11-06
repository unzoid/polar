//! libmpv inside the app on macOS and iOS. The drawing side is Objective-C: `macos/mpv_view.m`
//! (a CAOpenGLLayer under the window's transparent web view) and `ios/mpv_view.m` (an OpenGL ES
//! layer behind the web view), both with the same C functions below. mpv draws through its
//! render API there; Rust drives it over its JSON IPC as everywhere else.

use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::path::Path;

extern "C" {
    fn polar_mpv_create(
        libpath: *const c_char,
        host: *mut c_void,
        keys: *const *const c_char,
        vals: *const *const c_char,
        n: c_int,
        err: *mut c_char,
        errlen: usize,
    ) -> *mut c_void;
    fn polar_mpv_set_visible(player: *mut c_void, visible: c_int);
    fn polar_mpv_destroy(player: *mut c_void);
    fn polar_mpv_frames_open(player: *mut c_void) -> *mut c_void;
    fn polar_mpv_frames_close(client: *mut c_void);
    fn polar_mpv_frame(
        client: *mut c_void,
        w: *mut i64,
        h: *mut i64,
        stride: *mut i64,
        data: *mut *const u8,
        len: *mut usize,
    ) -> *mut c_void;
    fn polar_mpv_frame_free(frame: *mut c_void);
}

pub struct Player(*mut c_void);

// The pointer is only ever used through the functions above, which do
// their AppKit/UIKit work on the main thread themselves.
unsafe impl Send for Player {}

impl Player {
    /// Start mpv with `options` (name, value) and attach its video under `host`: the
    /// `NSWindow` on macOS, the web view (`WKWebView`) on iOS. Blocks while the main thread
    /// sets it up.
    pub fn start(lib: &Path, host: usize, options: &[(String, String)]) -> Result<Self, String> {
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
                host as *mut c_void,
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

    /// A reader of the frames this player shows, for autocrop, or `None`
    /// when this libmpv can't hand them over.
    pub fn frames(&self) -> Option<Frames> {
        let client = unsafe { polar_mpv_frames_open(self.0) };
        (!client.is_null()).then_some(Frames(client))
    }
}

/// A weak client of the player's mpv: once the player is gone, reading
/// fails instead of touching a freed core.
pub struct Frames(*mut c_void);

// libmpv's client functions may be called from any thread.
unsafe impl Send for Frames {}
unsafe impl Sync for Frames {}

impl Frames {
    /// `read` the frame shown now, unzoomed, in memory (`bgr0`); `None`
    /// when mpv has none or the player is gone. Blocks while mpv reads
    /// it back: call it off the async threads.
    pub fn read<R>(&self, read: impl FnOnce(polar_player::bars::Frame<'_>) -> R) -> Option<R> {
        let (mut w, mut h, mut stride, mut data, mut len) = (0i64, 0i64, 0i64, std::ptr::null(), 0usize);
        let frame = unsafe { polar_mpv_frame(self.0, &mut w, &mut h, &mut stride, &mut data, &mut len) };
        if frame.is_null() {
            return None;
        }
        let ok = w > 0 && h > 0 && stride > 0 && !data.is_null();
        let result = ok.then(|| {
            let bytes = unsafe { std::slice::from_raw_parts(data, len) };
            read(polar_player::bars::Frame {
                w: w as usize,
                h: h as usize,
                stride: stride as usize,
                format: polar_player::bars::PixelFormat::Bgr0,
                data: bytes,
            })
        });
        unsafe { polar_mpv_frame_free(frame) };
        result
    }
}

impl Drop for Frames {
    fn drop(&mut self) {
        unsafe { polar_mpv_frames_close(self.0) }
    }
}

impl Drop for Player {
    fn drop(&mut self) {
        unsafe { polar_mpv_destroy(self.0) }
    }
}
