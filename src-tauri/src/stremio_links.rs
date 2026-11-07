//! Settings → Add-ons → "Open Stremio links in Polarity" (#163), off by default: whether links
//! meant for Stremio (`stremio://…`) come to Polarity on this computer. The links themselves arrive
//! like Polarity's own (deep_link.rs) and the webview reads them (src/lib/deepLink/stremio.ts).
//!
//! Each system picks the app for a scheme its own way, and turning it off gives the links back:
//! - Windows: the scheme's per-user registration points at Polarity. The one it replaced (Stremio's,
//!   when Stremio registered per user) is kept next to it and put back when turned off; a
//!   machine-wide registration is never touched, and comes back by itself once ours is gone.
//! - Linux: Polarity's handler .desktop file lists the scheme and becomes its default (xdg-mime);
//!   turned off, both are taken out again.
//! - macOS: the app declares the scheme (tauri.macos.conf.json), so macOS may pick it; turned on,
//!   Polarity asks to be the default; turned off, the default goes back to another app that
//!   declares it (Stremio), if there is one.
//! - Android: an activity alias that is off until the setting turns it on (gen/android, through
//!   the web view's `polarDevice`), so nothing here.

/// The scheme Stremio's buttons open.
pub const SCHEME: &str = "stremio";

#[tauri::command]
pub fn stremio_links_set(app: tauri::AppHandle, on: bool) -> Result<(), String> {
    let done = imp::set(&app, on);
    if let Err(e) = &done {
        tracing::warn!("stremio links: {} failed: {e}", if on { "turning on" } else { "turning off" });
    }
    done
}

#[cfg(windows)]
mod imp {
    use windows_registry::CURRENT_USER;

    const KEY: &str = r"Software\Classes\stremio";
    /// Where the replaced registration waits, inside the scheme's own key.
    const KEPT_COMMAND: &str = "PolarityReplacedCommand";
    const KEPT_ICON: &str = "PolarityReplacedIcon";

    fn command_key() -> String {
        format!(r"{KEY}\shell\open\command")
    }

    fn icon_key() -> String {
        format!(r"{KEY}\DefaultIcon")
    }

    fn read(path: &str) -> Option<String> {
        CURRENT_USER.open(path).ok()?.get_string("").ok()
    }

    pub fn set<R: tauri::Runtime>(app: &tauri::AppHandle<R>, on: bool) -> Result<(), String> {
        let exe = tauri::utils::platform::current_exe().map_err(|e| e.to_string())?;
        // Without the verbatim prefix current_exe can give, as Windows shows paths.
        let exe = exe.display().to_string();
        let exe = exe.strip_prefix(r"\\?\").unwrap_or(&exe);
        let ours = format!("\"{exe}\" \"%1\"");
        let current = read(&command_key());
        let is_ours = |cmd: &str| cmd.eq_ignore_ascii_case(&ours);
        fn e(e: impl std::fmt::Display) -> String {
            e.to_string()
        }
        if on {
            let key = CURRENT_USER.create(KEY).map_err(e)?;
            // Another app's registration: kept, unless one is already kept (turned on twice).
            if let Some(theirs) = current.as_deref().filter(|c| !is_ours(c)) {
                if key.get_string(KEPT_COMMAND).is_err() {
                    key.set_string(KEPT_COMMAND, theirs).map_err(e)?;
                    if let Some(icon) = read(&icon_key()) {
                        key.set_string(KEPT_ICON, icon).map_err(e)?;
                    }
                }
            }
            key.set_string("", format!("URL:{} protocol", app.config().identifier)).map_err(e)?;
            key.set_string("URL Protocol", "").map_err(e)?;
            CURRENT_USER.create(icon_key()).and_then(|k| k.set_string("", format!("{exe},0"))).map_err(e)?;
            CURRENT_USER.create(command_key()).and_then(|k| k.set_string("", &ours)).map_err(e)?;
            return Ok(());
        }
        let Ok(key) = CURRENT_USER.open(KEY) else { return Ok(()) };
        let kept = key.get_string(KEPT_COMMAND).ok();
        let kept_icon = key.get_string(KEPT_ICON).ok();
        let _ = key.remove_value(KEPT_COMMAND);
        let _ = key.remove_value(KEPT_ICON);
        // Someone registered over ours since: theirs stays.
        if !current.as_deref().is_some_and(is_ours) {
            return Ok(());
        }
        match kept {
            Some(theirs) => {
                CURRENT_USER.create(command_key()).and_then(|k| k.set_string("", theirs)).map_err(e)?;
                match kept_icon {
                    Some(icon) => CURRENT_USER.create(icon_key()).and_then(|k| k.set_string("", icon)).map_err(e)?,
                    None => {
                        let _ = CURRENT_USER.remove_tree(icon_key());
                    }
                }
                Ok(())
            }
            None => CURRENT_USER.remove_tree(KEY).map_err(e),
        }
    }
}

#[cfg(target_os = "linux")]
mod imp {
    use tauri_plugin_deep_link::DeepLinkExt;

    pub fn set<R: tauri::Runtime>(app: &tauri::AppHandle<R>, on: bool) -> Result<(), String> {
        let links = app.deep_link();
        if on { links.register(super::SCHEME) } else { links.unregister(super::SCHEME) }.map_err(|e| e.to_string())
    }
}

#[cfg(mobile)]
mod imp {
    pub fn set<R: tauri::Runtime>(_app: &tauri::AppHandle<R>, _on: bool) -> Result<(), String> {
        Ok(())
    }
}

#[cfg(target_os = "macos")]
mod imp {
    //! Launch Services, by its C functions (the CoreServices framework every app links).
    use std::ffi::{c_char, c_void};

    type CFStringRef = *const c_void;
    type CFArrayRef = *const c_void;

    const UTF8: u32 = 0x0800_0100;

    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFStringCreateWithBytes(
            alloc: *const c_void,
            bytes: *const u8,
            len: isize,
            encoding: u32,
            external: u8,
        ) -> CFStringRef;
        fn CFStringGetCString(s: CFStringRef, buf: *mut c_char, size: isize, encoding: u32) -> u8;
        fn CFArrayGetCount(a: CFArrayRef) -> isize;
        fn CFArrayGetValueAtIndex(a: CFArrayRef, i: isize) -> *const c_void;
        fn CFRelease(cf: *const c_void);
    }

    #[link(name = "CoreServices", kind = "framework")]
    extern "C" {
        fn LSCopyDefaultHandlerForURLScheme(scheme: CFStringRef) -> CFStringRef;
        fn LSCopyAllHandlersForURLScheme(scheme: CFStringRef) -> CFArrayRef;
        fn LSSetDefaultHandlerForURLScheme(scheme: CFStringRef, bundle: CFStringRef) -> i32;
    }

    /// An owned CFString.
    struct Cf(CFStringRef);

    impl Cf {
        fn new(s: &str) -> Self {
            // SAFETY: the bytes are valid UTF-8 of the given length.
            Self(unsafe { CFStringCreateWithBytes(std::ptr::null(), s.as_ptr(), s.len() as isize, UTF8, 0) })
        }
    }

    impl Drop for Cf {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: created or copied by us, released once.
                unsafe { CFRelease(self.0) }
            }
        }
    }

    fn text(s: CFStringRef) -> Option<String> {
        if s.is_null() {
            return None;
        }
        let mut buf = [0 as c_char; 512];
        // SAFETY: the buffer's size is passed; the result is NUL-terminated when it succeeds.
        let ok = unsafe { CFStringGetCString(s, buf.as_mut_ptr(), buf.len() as isize, UTF8) } != 0;
        // SAFETY: as above.
        ok.then(|| unsafe { std::ffi::CStr::from_ptr(buf.as_ptr()) }.to_string_lossy().into_owned())
    }

    fn set_default(scheme: &Cf, bundle: &str) -> Result<(), String> {
        let bundle = Cf::new(bundle);
        // SAFETY: both are live CFStrings.
        match unsafe { LSSetDefaultHandlerForURLScheme(scheme.0, bundle.0) } {
            0 => Ok(()),
            status => Err(format!("Launch Services refused ({status})")),
        }
    }

    pub fn set<R: tauri::Runtime>(app: &tauri::AppHandle<R>, on: bool) -> Result<(), String> {
        let ours = app.config().identifier.clone();
        let scheme = Cf::new(super::SCHEME);
        if on {
            return set_default(&scheme, &ours);
        }
        // SAFETY: copies, released by Cf.
        let current = Cf(unsafe { LSCopyDefaultHandlerForURLScheme(scheme.0) });
        if !text(current.0).is_some_and(|c| c.eq_ignore_ascii_case(&ours)) {
            return Ok(());
        }
        // SAFETY: as above; the array's items belong to it.
        let all = Cf(unsafe { LSCopyAllHandlersForURLScheme(scheme.0) });
        if all.0.is_null() {
            return Ok(());
        }
        let count = unsafe { CFArrayGetCount(all.0) };
        let other = (0..count)
            .filter_map(|i| text(unsafe { CFArrayGetValueAtIndex(all.0, i) }))
            .find(|b| !b.eq_ignore_ascii_case(&ours));
        // No other app declares it: links keep coming here and the app says the setting is off.
        match other {
            Some(other) => set_default(&scheme, &other),
            None => Ok(()),
        }
    }
}
