//! iOS's own alerts, action sheets and share sheet (ios/dialogs.m; src/lib/platform/nativeDialogs.ts
//! on the web side). `native_dialog` shows a UIAlertController and answers with the id of the
//! action picked (none when it was dismissed); `native_share` opens the share sheet. Elsewhere
//! the web app draws its own and these answer nothing.

use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Style {
    Default,
    Cancel,
    Destructive,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Action {
    pub id: String,
    pub label: String,
    pub style: Style,
}

/// Where in the web view (CSS pixels) an action sheet or the share sheet points from on an iPad.
#[derive(Debug, Deserialize, Serialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    /// In the middle of the screen: a question that needs an answer.
    Alert,
    /// From the bottom on an iPhone, from `anchor` on an iPad: a choice of actions.
    Sheet,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Dialog {
    pub kind: Kind,
    pub title: Option<String>,
    pub message: Option<String>,
    pub actions: Vec<Action>,
    pub anchor: Option<Rect>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct Share {
    pub text: String,
    pub url: Option<String>,
    pub anchor: Option<Rect>,
}

#[cfg(target_os = "ios")]
mod ios {
    use crate::locks::Locked;
    use std::collections::HashMap;
    use std::ffi::{c_char, CStr, CString};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{LazyLock, Mutex};
    use tokio::sync::oneshot;

    extern "C" {
        fn polar_dialog_show(json: *const c_char, request: u64);
        fn polar_share_show(json: *const c_char);
    }

    type Answer = oneshot::Sender<Option<String>>;
    static PENDING: LazyLock<Mutex<HashMap<u64, Answer>>> = LazyLock::new(Default::default);
    static NEXT: AtomicU64 = AtomicU64::new(1);

    fn json(value: &impl serde::Serialize) -> Option<CString> {
        serde_json::to_string(value).ok().and_then(|j| CString::new(j).ok())
    }

    pub async fn dialog(dialog: &super::Dialog) -> Option<String> {
        let json = json(dialog)?;
        let request = NEXT.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = oneshot::channel();
        PENDING.locked().insert(request, tx);
        unsafe { polar_dialog_show(json.as_ptr(), request) };
        rx.await.ok().flatten()
    }

    pub fn share(share: &super::Share) {
        match json(share) {
            Some(json) => unsafe { polar_share_show(json.as_ptr()) },
            None => tracing::warn!("share sheet: couldn't encode what to share"),
        }
    }

    /// ios/dialogs.m calls this on the main thread once dialog `request` closes: with the id of
    /// the action picked, or null when it went away without one.
    #[no_mangle]
    pub extern "C" fn polar_dialog_done(request: u64, action: *const c_char) {
        let action = (!action.is_null()).then(|| unsafe { CStr::from_ptr(action) }.to_string_lossy().into_owned());
        if let Some(tx) = PENDING.locked().remove(&request) {
            let _ = tx.send(action);
        }
    }
}

/// Show `dialog`; answers with the id of the action picked.
#[tauri::command]
pub async fn native_dialog(dialog: Dialog) -> Option<String> {
    #[cfg(target_os = "ios")]
    return ios::dialog(&dialog).await;
    #[cfg(not(target_os = "ios"))]
    {
        let _ = dialog;
        None
    }
}

/// Open the share sheet with `share`.
#[tauri::command]
pub fn native_share(share: Share) {
    #[cfg(target_os = "ios")]
    ios::share(&share);
    #[cfg(not(target_os = "ios"))]
    let _ = share;
}
