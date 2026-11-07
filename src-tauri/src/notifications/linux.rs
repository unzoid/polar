//! Linux: the desktop's notification service, org.freedesktop.Notifications on the session bus
//! (GNOME, KDE, and the standalone daemons all provide it). A note's default action is its click.

use super::{clicked, Note, Permission};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use zbus::blocking::{Connection, Proxy};
use zbus::zvariant::Value;

const DEST: &str = "org.freedesktop.Notifications";
const PATH: &str = "/org/freedesktop/Notifications";

#[derive(Default)]
struct Shown {
    /// Our note id → the service's, so a newer note about the same thing replaces it.
    by_note: HashMap<String, u32>,
    /// The service's id → what a click opens.
    payloads: HashMap<u32, String>,
}

static BUS: OnceLock<Option<Connection>> = OnceLock::new();
static SHOWN: Mutex<Option<Shown>> = Mutex::new(None);

fn bus() -> Option<&'static Connection> {
    BUS.get_or_init(|| match Connection::session() {
        Ok(c) => Some(c),
        Err(e) => {
            tracing::info!("notifications: no session bus: {e}");
            None
        }
    })
    .as_ref()
}

fn proxy(bus: &Connection) -> zbus::Result<Proxy<'static>> {
    Proxy::new(bus, DEST, PATH, DEST)
}

/// The body is read as a little markup by most services: shown as text.
fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// Listens for clicks on a thread of its own.
pub fn start() {
    std::thread::spawn(|| {
        let Some(bus) = bus() else { return };
        let signals = proxy(bus).and_then(|p| p.receive_signal("ActionInvoked"));
        let signals = match signals {
            Ok(s) => s,
            Err(e) => return tracing::info!("notifications: clicks not heard: {e}"),
        };
        for message in signals {
            let Ok((id, action)) = message.body().deserialize::<(u32, String)>() else { continue };
            if action != "default" {
                continue;
            }
            let payload =
                SHOWN.lock().unwrap_or_else(|e| e.into_inner()).as_mut().and_then(|s| s.payloads.get(&id).cloned());
            if let Some(payload) = payload {
                clicked(payload);
            }
        }
    });
}

/// Nothing to ask on Linux: there's a service or there isn't.
pub async fn permission() -> Permission {
    if bus().is_some() {
        "granted"
    } else {
        "denied"
    }
}

pub async fn request() -> Permission {
    permission().await
}

pub async fn show(note: Note) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bus = bus().ok_or("no session bus")?;
        let proxy = proxy(bus).map_err(|e| e.to_string())?;
        let replaces = SHOWN
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .and_then(|s| s.by_note.get(&note.id).copied())
            .unwrap_or(0);
        let hints: HashMap<&str, Value> = HashMap::new();
        let id: u32 = proxy
            .call(
                "Notify",
                &(
                    "Polarity",
                    replaces,
                    "",
                    note.title.as_str(),
                    escape(&note.body),
                    vec!["default", "Open"],
                    hints,
                    -1i32,
                ),
            )
            .map_err(|e| e.to_string())?;
        let mut shown = SHOWN.lock().unwrap_or_else(|e| e.into_inner());
        let shown = shown.get_or_insert_with(Shown::default);
        shown.by_note.insert(note.id, id);
        shown.payloads.insert(id, note.payload);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    #[test]
    fn markup_is_shown_as_text() {
        assert_eq!(super::escape("<b>S1 & S2</b>"), "&lt;b&gt;S1 &amp; S2&lt;/b&gt;");
    }
}
