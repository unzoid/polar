//! iOS's own tab bar for the app's sections (ios/tabs.m, a UITabBarController around the web
//! view; src/lib/platform/nativeTabs.ts on the web side). The web app says which tabs there are,
//! which one is current and whether the bar shows; a tab the user picks comes back as a
//! `native://tab` event carrying its id. Elsewhere the web app draws its own tabs and this does
//! nothing.

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

#[derive(Debug, Deserialize, Serialize)]
pub struct Tab {
    pub id: String,
    pub title: String,
    /// An SF Symbol name.
    pub icon: String,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Tabs {
    pub tabs: Vec<Tab>,
    pub selected: Option<String>,
    pub hidden: bool,
}

#[cfg(target_os = "ios")]
static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

/// Show `tabs`; the first call puts the tab bar around the web view.
#[tauri::command]
pub fn native_tabs(app: AppHandle, tabs: Tabs) {
    #[cfg(target_os = "ios")]
    {
        extern "C" {
            fn polar_tabs_set(json: *const std::ffi::c_char);
        }
        APP.get_or_init(|| app);
        let json = serde_json::to_string(&tabs).ok().and_then(|j| std::ffi::CString::new(j).ok());
        match json {
            Some(json) => unsafe { polar_tabs_set(json.as_ptr()) },
            None => tracing::warn!("tab bar: couldn't encode the tabs"),
        }
    }
    #[cfg(not(target_os = "ios"))]
    let _ = (app, tabs);
}

/// ios/tabs.m calls this on the main thread when the user picks a tab, or picks the current one
/// again (back to its top).
#[cfg(target_os = "ios")]
#[no_mangle]
pub extern "C" fn polar_tab_chosen(id: *const std::ffi::c_char) {
    use tauri::Emitter;
    if id.is_null() {
        return;
    }
    let id = unsafe { std::ffi::CStr::from_ptr(id) }.to_string_lossy().into_owned();
    if let Some(app) = APP.get() {
        if let Err(e) = app.emit("native://tab", id) {
            tracing::warn!("tab bar: {e}");
        }
    }
}
