//! iOS's own back button (ios/back.m; src/lib/platform/nativeBack.ts on the web side): a system
//! button laid over the web app's Back where it stands, Liquid Glass on iOS 26 and later. The web
//! app says where its Back is, whether it shows and the pages behind it; a tap comes back as a
//! `native://back` event carrying 1, a page picked from its long-press menu as how many steps back
//! that is. Elsewhere the web app's own Back shows and this does nothing.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// Where the web app's Back is, in CSS pixels of the web view.
#[derive(Debug, Deserialize, Serialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Back {
    pub shown: bool,
    pub rect: Option<Rect>,
    /// The pages behind, nearest first, for the long-press menu.
    pub history: Vec<String>,
}

#[cfg(target_os = "ios")]
static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

/// Show, move or hide the back button.
#[tauri::command]
pub fn native_back(app: AppHandle, back: Back) {
    #[cfg(target_os = "ios")]
    {
        extern "C" {
            fn polar_back_set(json: *const std::ffi::c_char);
        }
        APP.get_or_init(|| app);
        let json = serde_json::to_string(&back).ok().and_then(|j| std::ffi::CString::new(j).ok());
        match json {
            Some(json) => unsafe { polar_back_set(json.as_ptr()) },
            None => tracing::warn!("back button: couldn't encode it"),
        }
    }
    #[cfg(not(target_os = "ios"))]
    let _ = (app, back);
}

/// ios/back.m calls this on the main thread when the button is tapped (1) or a page is picked
/// from its menu (how many steps back).
#[cfg(target_os = "ios")]
#[no_mangle]
pub extern "C" fn polar_back_pressed(steps: u32) {
    use tauri::Emitter;
    if let Some(app) = APP.get() {
        if let Err(e) = app.emit("native://back", steps.max(1)) {
            tracing::warn!("back button: {e}");
        }
    }
}
