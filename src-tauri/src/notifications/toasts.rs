//! Windows: toasts, under the app's id (the installer's Start menu shortcut carries it; a build
//! run without installing has no shortcut, and Windows then shows nothing). A click while the app
//! runs comes back through the toast's Activated event; desktops only notify while running.

use super::{clicked, Note, Permission};
use std::collections::HashMap;
use std::sync::Mutex;
use windows::core::{IInspectable, Ref, HSTRING};
use windows::Data::Xml::Dom::XmlDocument;
use windows::Foundation::TypedEventHandler;
use windows::UI::Notifications::{NotificationSetting, ToastNotification, ToastNotificationManager};

/// The bundle identifier (tauri.conf.json), which the installer gives the shortcut as its AppUserModelID.
const APP_ID: &str = "app.getpolar.desktop";

/// The toasts on screen, by note id: kept so their click handlers live as long as they do.
static TOASTS: Mutex<Option<HashMap<String, ToastNotification>>> = Mutex::new(None);

pub fn start() {}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

/// A short tag for a note id: a newer toast with the same tag replaces the older one.
fn tag(id: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut h = std::collections::hash_map::DefaultHasher::new();
    id.hash(&mut h);
    format!("{:016x}", h.finish())
}

/// Whether the user (or a policy) has turned Polarity's notifications off in Windows' settings.
pub async fn permission() -> Permission {
    let setting = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(APP_ID)).and_then(|n| n.Setting());
    match setting {
        Ok(NotificationSetting::Enabled) => "granted",
        Ok(_) => "denied",
        Err(e) => {
            tracing::info!("notifications: no toast setting: {e}");
            "denied"
        }
    }
}

/// Windows doesn't ask: on unless turned off in its settings.
pub async fn request() -> Permission {
    permission().await
}

pub async fn show(note: Note) -> Result<(), String> {
    show_toast(note).map_err(|e| e.to_string())
}

fn show_toast(note: Note) -> windows::core::Result<()> {
    let xml = format!(
        "<toast><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual></toast>",
        escape(&note.title),
        escape(&note.body)
    );
    let doc = XmlDocument::new()?;
    doc.LoadXml(&HSTRING::from(xml))?;
    let toast = ToastNotification::CreateToastNotification(&doc)?;
    toast.SetTag(&HSTRING::from(tag(&note.id)))?;
    let payload = note.payload;
    toast.Activated(&TypedEventHandler::new(move |_: Ref<ToastNotification>, _: Ref<IInspectable>| {
        clicked(payload.clone());
        Ok(())
    }))?;
    ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(APP_ID))?.Show(&toast)?;
    let mut toasts = TOASTS.lock().unwrap_or_else(|e| e.into_inner());
    let toasts = toasts.get_or_insert_with(HashMap::new);
    if toasts.len() >= 32 {
        // Older ones are long gone from the screen (or in the notification centre, where a click still opens the app).
        toasts.clear();
    }
    toasts.insert(note.id, toast);
    Ok(())
}
