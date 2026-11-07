//! Links that open Polarity (#153, #154, #208): `polarity://title/…` and `polarity://anime/…` (a
//! title, from the "Watch in Polarity" button on someone's Discord profile or the browser
//! extension's "Open in Polarity"), `polarity://party/…` (a watch party's join link) and
//! `polarity://together/…` (a video link to watch together, from the browser extension), handed
//! over by the website's /watch and /party pages. The deep-link plugin registers the
//! scheme with the system (desktop); the single-instance plugin hands a link opened while Polarity
//! already runs to the running app instead of starting a second one.
//!
//! Links wait here until the webview takes them ([`deep_links_take`]), so one that started the app
//! isn't lost before the page listens; each arrival is also announced with a `deep-link` event.
//! The webview reads them as untrusted input (src/lib/deepLink): nothing here acts on one.
//!
//! Links meant for Stremio (`stremio://…`, #163) wait here too, when the user lets them come to
//! Polarity (stremio_links.rs). The plugin only reads the schemes in tauri.conf.json from a launch's
//! arguments, so Windows and Linux hand those over through [`from_args`].
// The phone apps don't register the scheme yet: nothing arrives there.
#![cfg_attr(any(target_os = "android", target_os = "ios"), allow(dead_code))]

use std::sync::Mutex;

use crate::locks::Locked;

/// The scheme the website's pages open.
pub const SCHEME: &str = "polarity";
/// Longer than any link Polarity makes (a watch-together link carries a video's address, up to
/// 2048 characters before it's escaped); anything longer isn't one of ours.
const MAX_LEN: usize = 8192;
/// An add-on's install link carries its settings in the address, so it can be long.
const MAX_STREMIO_LEN: usize = 4096;
/// A flood of links (a page opening them in a loop) keeps only the latest few.
const MAX_WAITING: usize = 8;

static WAITING: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Keeps `url` for the webview if it's one of ours; says whether it was.
fn keep(url: &str) -> bool {
    let with = |scheme: &str, max: usize| {
        url.len() <= max && url.strip_prefix(scheme).is_some_and(|rest| rest.starts_with("://"))
    };
    let ours = (with(SCHEME, MAX_LEN) || with(crate::stremio_links::SCHEME, MAX_STREMIO_LEN))
        && url.bytes().all(|b| b.is_ascii_graphic());
    if ours {
        let mut waiting = WAITING.locked();
        waiting.push(url.to_string());
        let extra = waiting.len().saturating_sub(MAX_WAITING);
        waiting.drain(..extra);
    }
    ours
}

#[cfg(desktop)]
pub fn init<R: tauri::Runtime>(app: &tauri::App<R>) {
    use tauri_plugin_deep_link::DeepLinkExt;

    let links = app.deep_link();
    // An AppImage has no installer to register the scheme: it registers itself when it runs.
    #[cfg(target_os = "linux")]
    if std::env::var_os("APPIMAGE").is_some() {
        if let Err(e) = links.register(SCHEME) {
            tracing::warn!("deep link: scheme not registered: {e}");
        }
    }
    if let Ok(Some(urls)) = links.get_current() {
        arrived(app.handle(), urls.iter().map(|u| u.as_str()));
    }
    from_args(app.handle(), std::env::args());
    let handle = app.handle().clone();
    links.on_open_url(move |event| arrived(&handle, event.urls().iter().map(|u| u.as_str())));
}

#[cfg(desktop)]
fn arrived<'a, R: tauri::Runtime>(handle: &tauri::AppHandle<R>, urls: impl Iterator<Item = &'a str>) {
    use tauri::{Emitter, Manager};

    let kept = urls.filter(|u| keep(u)).count();
    if kept > 0 {
        tracing::info!("deep link: {kept} arrived");
        let _ = handle.emit("deep-link", ());
        if let Some(w) = handle.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.set_focus();
        }
    }
}

/// A `stremio://` link that started Polarity, or that a second launch handed over: Windows and
/// Linux pass it as the only argument. (Polarity's own scheme comes through the plugin.)
#[cfg(desktop)]
pub fn from_args<R: tauri::Runtime, S: AsRef<str>>(handle: &tauri::AppHandle<R>, args: impl IntoIterator<Item = S>) {
    let args: Vec<S> = args.into_iter().collect();
    if let [_, link] = args.as_slice() {
        let link = link.as_ref();
        if link.strip_prefix(crate::stremio_links::SCHEME).is_some_and(|rest| rest.starts_with("://")) {
            arrived(handle, std::iter::once(link));
        }
    }
}

/// The links that arrived since the webview last asked, oldest first.
#[tauri::command]
pub fn deep_links_take() -> Vec<String> {
    std::mem::take(&mut *WAITING.locked())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_only_polarity_links_and_only_the_latest_few() {
        deep_links_take();
        assert!(keep("polarity://title/movie/tt0000000"));
        let video = format!("polarity://together/{}", "%2F".repeat(2048));
        assert!(keep(&video));
        assert!(!keep("https://getpolar.app/watch"));
        assert!(!keep("polarityx://title/movie/tt0000000"));
        assert!(!keep("polarity:title"));
        assert!(!keep("polarity://party/a b"));
        assert!(!keep(&format!("polarity://party/{}", "a".repeat(MAX_LEN))));
        assert_eq!(deep_links_take(), ["polarity://title/movie/tt0000000".to_string(), video]);
        // Stremio's links (#163): an install link may be long; still nothing that isn't a link.
        let install = format!("stremio://addon.example.com/{}/manifest.json", "c".repeat(1500));
        assert!(keep(&install));
        assert!(keep("stremio:///detail/series/tt0000000/tt0000000:1:2"));
        assert!(!keep("stremio:detail"));
        assert!(!keep("stremio://addon.example.com/a b/manifest.json"));
        assert!(!keep(&format!("stremio://addon.example.com/{}/manifest.json", "c".repeat(5000))));
        assert_eq!(deep_links_take(), [install.as_str(), "stremio:///detail/series/tt0000000/tt0000000:1:2"]);
        assert!(deep_links_take().is_empty());
        for n in 0..20 {
            keep(&format!("polarity://party/{n}"));
        }
        let waiting = deep_links_take();
        assert_eq!(waiting.len(), MAX_WAITING);
        assert_eq!(waiting.last().unwrap(), "polarity://party/19");
    }
}
