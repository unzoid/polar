//! The `trailer` protocol (re-test 16): a trailer the `trailer` command found, served from the app
//! with CORS allowed, so the backdrop can read its frames for black bars. Rules (ranges, paths) in
//! `polar_player::passthrough`; only links the command handed out are served, so the web view
//! can't use it to reach anything else.

use crate::locks::Locked;
use polar_player::passthrough::{capped_range, from_hex, CHUNK};
use std::collections::HashSet;
use std::sync::{LazyLock, Mutex};
use tauri::http::{Request, Response};

static ALLOWED: LazyLock<Mutex<HashSet<String>>> = LazyLock::new(Default::default);
static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder().connect_timeout(std::time::Duration::from_secs(15)).build().unwrap_or_default()
});

/// The headers of the host's answer that the web view needs.
const KEPT: [&str; 3] = ["content-type", "content-range", "accept-ranges"];

/// Lets the protocol serve `link` (called with each trailer the command returns).
pub fn allow(link: &str) {
    ALLOWED.locked().insert(link.to_owned());
}

/// Adds the protocol to the app.
pub fn register<R: tauri::Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.register_asynchronous_uri_scheme_protocol("trailer", |_ctx, request, responder| {
        tauri::async_runtime::spawn(async move { responder.respond(answer(request).await) });
    })
}

fn status(code: u16) -> Response<Vec<u8>> {
    Response::builder().status(code).header("access-control-allow-origin", "*").body(Vec::new()).unwrap_or_default()
}

async fn answer(request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let Some(link) = from_hex(request.uri().path().trim_start_matches('/')) else { return status(400) };
    if !ALLOWED.locked().contains(&link) {
        return status(403);
    }
    let asked = request.headers().get("range").and_then(|v| v.to_str().ok());
    let sent = CLIENT.get(&link).header("range", capped_range(asked, CHUNK)).send().await;
    let resp = match sent {
        Ok(resp) => resp,
        Err(e) => {
            tracing::warn!("trailer not fetched: {}", e.without_url());
            return status(502);
        }
    };
    let mut out = Response::builder().status(resp.status().as_u16()).header("access-control-allow-origin", "*");
    for name in KEPT {
        if let Some(v) = resp.headers().get(name) {
            out = out.header(name, v.as_bytes());
        }
    }
    let body = match resp.bytes().await {
        Ok(b) => b.to_vec(),
        Err(e) => {
            tracing::warn!("trailer cut off: {}", e.without_url());
            return status(502);
        }
    };
    out.header("content-length", body.len()).body(body).unwrap_or_else(|_| status(502))
}
