//! Game controller detection, natively.
//!
//! The WebView's Gamepad API hides a controller until one of its buttons is
//! pressed (a fingerprinting guard), so the UI can't tell a controller is
//! plugged in — or say hello to it — until you've already used it. Here the
//! OS reports them as they come and go (gilrs: Windows.Gaming.Input / XInput
//! on Windows, evdev on Linux, IOKit on macOS), and the frontend hears about
//! it as `controller-connected` / `controller-disconnected` events. Input
//! itself still goes through the Gamepad API.

use std::sync::Mutex;
use std::time::Duration;

use gilrs::{EventType, Gilrs};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Controller {
    pub id: usize,
    pub name: String,
}

#[derive(Default)]
pub struct Controllers {
    /// `None` until the watcher is running (or if it couldn't start).
    connected: Mutex<Option<Vec<Controller>>>,
}

fn info(gilrs: &Gilrs, id: gilrs::GamepadId) -> Controller {
    let pad = gilrs.gamepad(id);
    Controller { id: id.into(), name: pad.name().to_string() }
}

/// Watch for controllers on a thread of its own, for the life of the app.
pub fn watch(app: AppHandle) {
    std::thread::Builder::new()
        .name("controllers".into())
        .spawn(move || {
            let mut gilrs = match Gilrs::new() {
                Ok(g) => g,
                Err(gilrs::Error::NotImplemented(g)) => g,
                Err(e) => {
                    tracing::warn!("controller detection unavailable: {e}");
                    return;
                }
            };
            let state = app.state::<Controllers>();
            let initial: Vec<Controller> = gilrs.gamepads().map(|(id, _)| info(&gilrs, id)).collect();
            *state.connected.lock().unwrap() = Some(initial);

            loop {
                // Blocking with a timeout keeps the thread asleep between events.
                while let Some(ev) = gilrs.next_event_blocking(Some(Duration::from_secs(1))) {
                    match ev.event {
                        EventType::Connected => {
                            let c = info(&gilrs, ev.id);
                            let mut list = state.connected.lock().unwrap();
                            let list = list.get_or_insert_with(Vec::new);
                            list.retain(|x| x.id != c.id);
                            list.push(c.clone());
                            let _ = app.emit("controller-connected", c);
                        }
                        EventType::Disconnected => {
                            let c = info(&gilrs, ev.id);
                            if let Some(list) = state.connected.lock().unwrap().as_mut() {
                                list.retain(|x| x.id != c.id);
                            }
                            let _ = app.emit("controller-disconnected", c);
                        }
                        _ => {}
                    }
                }
            }
        })
        .expect("spawn controller watcher");
}

/// Controllers connected right now; `None` if native detection isn't running.
#[tauri::command]
pub fn controllers_list(state: State<'_, Controllers>) -> Option<Vec<Controller>> {
    state.connected.lock().unwrap().clone()
}
