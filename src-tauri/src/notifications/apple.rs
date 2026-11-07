//! macOS and iOS: UserNotifications through src/apple/notes.m. Answers come back on the
//! centre's own queue, through a callback carrying the sender they're for.

use super::{clicked, Note, Permission};
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use tokio::sync::oneshot;

type Done = extern "C" fn(*mut c_void, c_int);

extern "C" {
    fn polar_notes_start();
    fn polar_notes_permission(ctx: *mut c_void, done: Done);
    fn polar_notes_request(ctx: *mut c_void, done: Done);
    fn polar_notes_show(id: *const c_char, title: *const c_char, body: *const c_char, payload: *const c_char);
    #[cfg(target_os = "ios")]
    fn polar_notes_plan(json: *const c_char);
}

pub fn start() {
    unsafe { polar_notes_start() }
}

/// notes.m calls this once per question, with the sender `ask` gave it.
extern "C" fn answered(ctx: *mut c_void, status: c_int) {
    let tx = unsafe { Box::from_raw(ctx as *mut oneshot::Sender<c_int>) };
    let _ = tx.send(status);
}

async fn ask(question: unsafe extern "C" fn(*mut c_void, Done)) -> Permission {
    let (tx, rx) = oneshot::channel::<c_int>();
    let ctx = Box::into_raw(Box::new(tx)) as *mut c_void;
    unsafe { question(ctx, answered) };
    match rx.await {
        Ok(1) => "granted",
        Ok(0) => "prompt",
        _ => "denied",
    }
}

pub async fn permission() -> Permission {
    ask(polar_notes_permission).await
}

pub async fn request() -> Permission {
    ask(polar_notes_request).await
}

fn c(text: &str) -> CString {
    CString::new(text.replace('\0', "")).unwrap_or_default()
}

pub async fn show(note: Note) -> Result<(), String> {
    let (id, title, body, payload) = (c(&note.id), c(&note.title), c(&note.body), c(&note.payload));
    unsafe { polar_notes_show(id.as_ptr(), title.as_ptr(), body.as_ptr(), payload.as_ptr()) };
    Ok(())
}

#[cfg(target_os = "ios")]
pub async fn plan(notes: Vec<super::PlannedNote>) -> Result<(), String> {
    let list: Vec<serde_json::Value> = notes
        .into_iter()
        .map(|n| serde_json::json!({ "id": n.id, "title": n.title, "body": n.body, "payload": n.payload, "at": n.at }))
        .collect();
    let json = c(&serde_json::Value::Array(list).to_string());
    unsafe { polar_notes_plan(json.as_ptr()) };
    Ok(())
}

/// notes.m calls this when a note is clicked.
#[no_mangle]
pub extern "C" fn polar_note_clicked(payload: *const c_char) {
    if payload.is_null() {
        return;
    }
    let payload = unsafe { CStr::from_ptr(payload) }.to_string_lossy().into_owned();
    clicked(payload);
}
