//! The IPC surface the UI talks to. Every command is async and never blocks
//! the UI thread; network fan-out happens concurrently.

use std::sync::Arc;
use std::time::Duration;

use futures::future::join_all;
use polar_addon::{rank_streams, Meta, MetaPreview, RankedStream, Stream};
use polar_index::Indexer;
use serde::Serialize;
use tauri::State;

use crate::store::{now, InstalledAddon, LibraryItem, Progress, Settings};
use crate::AppState;

/// Errors cross IPC as plain strings; the UI only needs a message.
#[derive(Debug, thiserror::Error)]
pub enum CmdError {
    #[error(transparent)]
    Index(#[from] polar_index::IndexError),
    #[error(transparent)]
    Addon(#[from] polar_addon::AddonError),
    #[error("{0}")]
    Other(String),
}

impl Serialize for CmdError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}

pub type Result<T> = std::result::Result<T, CmdError>;

/// Per-addon budget. A slow addon must never hold the whole list hostage.
const ADDON_TIMEOUT: Duration = Duration::from_secs(8);

// --- Discovery -----------------------------------------------------------

#[tauri::command]
pub async fn catalog(
    state: State<'_, AppState>,
    ty: String,
    id: String,
    skip: Option<u32>,
    genre: Option<String>,
) -> Result<Vec<MetaPreview>> {
    Ok(state.indexer().catalog(&ty, &id, skip.unwrap_or(0), genre.as_deref()).await?)
}

/// Titles like `id` ("Because you watched …").
#[tauri::command]
pub async fn recommend(state: State<'_, AppState>, ty: String, id: String) -> Result<Vec<MetaPreview>> {
    Ok(state.indexer().recommend(&ty, &id).await?)
}

#[derive(Serialize)]
pub struct SearchResults {
    movies: Vec<MetaPreview>,
    series: Vec<MetaPreview>,
}

#[tauri::command]
pub async fn search(state: State<'_, AppState>, query: String) -> Result<SearchResults> {
    let ix: Arc<Indexer> = state.indexer();
    let (movies, series) = tokio::join!(ix.search("movie", &query), ix.search("series", &query));
    Ok(SearchResults { movies: movies?, series: series? })
}

#[tauri::command]
pub async fn meta(state: State<'_, AppState>, ty: String, id: String) -> Result<Meta> {
    if id.starts_with("tt") {
        return Ok(state.indexer().meta(&ty, &id).await?);
    }
    // Non-IMDb ids belong to whichever installed addon claims them.
    let addon = installed(&state)
        .into_iter()
        .find(|a| a.manifest.serves("meta", &ty, &id))
        .ok_or_else(|| CmdError::Other(format!("no addon provides metadata for {id}")))?;
    Ok(state.addons.meta(&addon.manifest_url, &ty, &id).await?)
}

// --- Streams -------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StreamsResult {
    streams: Vec<RankedStream>,
    /// Addons that failed or timed out, so the UI can say so instead of
    /// silently showing fewer results.
    failed: Vec<String>,
}

/// Query every installed stream addon concurrently, then rank and dedupe.
#[tauri::command]
pub async fn streams(state: State<'_, AppState>, ty: String, video_id: String) -> Result<StreamsResult> {
    let addons: Vec<InstalledAddon> = installed(&state)
        .into_iter()
        .filter(|a| a.manifest.serves("stream", &ty, &video_id))
        .collect();

    let client = &state.addons;
    let results = join_all(addons.iter().map(|a| async {
        let fetch = client.streams(&a.manifest_url, &ty, &video_id);
        let res = tokio::time::timeout(ADDON_TIMEOUT, fetch).await;
        (a.manifest.name.clone(), res)
    }))
    .await;

    let mut all = Vec::new();
    let mut failed = Vec::new();
    for (name, res) in results {
        match res {
            Ok(Ok(streams)) => all.extend(streams.into_iter().map(|s| (name.clone(), s))),
            _ => failed.push(name),
        }
    }
    Ok(StreamsResult { streams: rank_streams(all), failed })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Playable {
    /// Plays in the built-in player.
    Url { url: String },
    /// Needs a browser (e.g. YouTube trailers, "watch on" links).
    External { url: String },
    Unsupported { reason: String },
}

/// Turn a stream into something playable. p2ps go through the configured
/// bridge until the embedded engine (librqbit) lands.
#[tauri::command]
pub async fn resolve_stream(state: State<'_, AppState>, stream: Stream) -> Result<Playable> {
    if let Some(url) = stream.url {
        return Ok(Playable::Url { url });
    }
    if let Some(hash) = stream.content_id {
        let server = state.store.lock().unwrap().data.settings.bridge.clone();
        let server = server.trim_end_matches('/');
        let reachable = reqwest::Client::new()
            .get(format!("{server}/settings"))
            .timeout(Duration::from_millis(800))
            .send()
            .await
            .is_ok();
        if !reachable {
            return Ok(Playable::Unsupported {
                reason: "p2p streams need a bridge. Start Stremio's server, or wait for the built-in engine.".into(),
            });
        }
        let file = stream.file_idx.map(|f| f.to_string()).unwrap_or_else(|| "-1".into());
        return Ok(Playable::Url { url: format!("{server}/{}/{file}", hash.to_lowercase()) });
    }
    if let Some(yt) = stream.yt_id {
        return Ok(Playable::External { url: format!("https://www.youtube.com/watch?v={yt}") });
    }
    if let Some(url) = stream.external_url {
        return Ok(Playable::External { url });
    }
    Ok(Playable::Unsupported { reason: "This stream has no playable source.".into() })
}

// --- Addons --------------------------------------------------------------

fn installed(state: &State<'_, AppState>) -> Vec<InstalledAddon> {
    state.store.lock().unwrap().data.addons.clone()
}

fn persist(state: &State<'_, AppState>, f: impl FnOnce(&mut crate::store::Data)) -> Result<()> {
    let mut store = state.store.lock().unwrap();
    f(&mut store.data);
    store.save().map_err(|e| CmdError::Other(format!("could not save: {e}")))
}

#[tauri::command]
pub fn addons_list(state: State<'_, AppState>) -> Vec<InstalledAddon> {
    installed(&state)
}

#[tauri::command]
pub async fn addon_install(state: State<'_, AppState>, url: String) -> Result<InstalledAddon> {
    let url = url.trim().replace("stremio://", "https://");
    let manifest_url = if url.ends_with("/manifest.json") { url } else { format!("{}/manifest.json", url.trim_end_matches('/')) };
    let manifest = state.addons.manifest(&manifest_url).await?;
    let addon = InstalledAddon { manifest_url, manifest };
    let saved = addon.clone();
    persist(&state, |d| {
        d.addons.retain(|a| a.manifest.id != saved.manifest.id);
        d.addons.push(saved);
    })?;
    Ok(addon)
}

#[tauri::command]
pub fn addon_remove(state: State<'_, AppState>, id: String) -> Result<()> {
    persist(&state, |d| d.addons.retain(|a| a.manifest.id != id))
}

// --- Library & progress --------------------------------------------------

// Everything here acts on the active space (the signed-out "local" space or
// the selected profile), see `store::Space`.

#[tauri::command]
pub fn library_list(state: State<'_, AppState>) -> Vec<LibraryItem> {
    let store = state.store.lock().unwrap();
    let Some(space) = store.data.space() else { return Vec::new() };
    let mut items: Vec<_> = space.library.values().cloned().collect();
    items.sort_by(|a, b| b.added_at.cmp(&a.added_at));
    items
}

/// Returns whether the item is in the library afterwards.
#[tauri::command]
pub fn library_toggle(state: State<'_, AppState>, item: MetaPreview) -> Result<bool> {
    let mut added = false;
    persist(&state, |d| {
        let space = d.space_mut();
        let at = now();
        if space.library.remove(&item.id).is_some() {
            space.removed.insert(item.id, at);
        } else {
            added = true;
            space.removed.remove(&item.id);
            space.library.insert(
                item.id.clone(),
                LibraryItem { id: item.id, ty: item.ty, name: item.name, poster: item.poster, added_at: at },
            );
        }
    })?;
    Ok(added)
}

/// All progress entries for one title (every episode of a series).
#[tauri::command]
pub fn progress_for(state: State<'_, AppState>, meta_id: String) -> Vec<Progress> {
    let store = state.store.lock().unwrap();
    let Some(space) = store.data.space() else { return Vec::new() };
    space.progress.values().filter(|p| p.meta_id == meta_id).cloned().collect()
}

#[tauri::command]
pub fn progress_save(state: State<'_, AppState>, mut progress: Progress) -> Result<()> {
    progress.updated_at = now();
    persist(&state, |d| {
        d.space_mut().progress.insert(progress.video_id.clone(), progress);
    })
}

/// Latest unfinished video per title, newest first.
#[tauri::command]
pub fn continue_watching(state: State<'_, AppState>) -> Vec<Progress> {
    let store = state.store.lock().unwrap();
    let Some(space) = store.data.space() else { return Vec::new() };
    let mut latest: std::collections::HashMap<&str, &Progress> = Default::default();
    for p in space.progress.values() {
        let slot = latest.entry(p.meta_id.as_str()).or_insert(p);
        if p.updated_at > slot.updated_at {
            *slot = p;
        }
    }
    let mut items: Vec<Progress> = latest
        .into_values()
        .filter(|p| !p.finished() && p.position > 30.0)
        .cloned()
        .collect();
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    items.truncate(20);
    items
}

/// Everything you've watched: the latest video per title — finished or well
/// under way — newest first. The Library's "Watched" shelf.
#[tauri::command]
pub fn watch_history(state: State<'_, AppState>) -> Vec<Progress> {
    let store = state.store.lock().unwrap();
    let Some(space) = store.data.space() else { return Vec::new() };
    let mut latest: std::collections::HashMap<&str, &Progress> = Default::default();
    for p in space.progress.values().filter(|p| p.finished() || p.position > 30.0) {
        let slot = latest.entry(p.meta_id.as_str()).or_insert(p);
        if p.updated_at > slot.updated_at {
            *slot = p;
        }
    }
    let mut items: Vec<Progress> = latest.into_values().cloned().collect();
    items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    items.truncate(200);
    items
}

// --- Settings ------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    #[serde(flatten)]
    settings: Settings,
    metadata_source: &'static str,
}

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> SettingsView {
    let settings = state.store.lock().unwrap().data.settings.clone();
    SettingsView { settings, metadata_source: state.indexer().source() }
}

#[tauri::command]
pub fn settings_set(state: State<'_, AppState>, settings: Settings) -> Result<SettingsView> {
    let rebuild = {
        let store = state.store.lock().unwrap();
        store.data.settings.tmdb_key != settings.tmdb_key || store.data.settings.language != settings.language
    };
    if rebuild {
        *state.indexer.write().unwrap() = Arc::new(Indexer::new(crate::index_config(&settings)));
    }
    let next = settings.clone();
    persist(&state, |d| d.settings = next)?;
    Ok(SettingsView { settings, metadata_source: state.indexer().source() })
}

// --- Subtitles -----------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleOption {
    id: String,
    url: String,
    lang: String,
    addon: String,
}

/// External subtitles from every installed addon that serves them.
#[tauri::command]
pub async fn subtitles(state: State<'_, AppState>, ty: String, video_id: String) -> Result<Vec<SubtitleOption>> {
    let addons: Vec<InstalledAddon> = installed(&state)
        .into_iter()
        .filter(|a| a.manifest.serves("subtitles", &ty, &video_id))
        .collect();
    let client = &state.addons;
    let results = join_all(addons.iter().map(|a| async {
        let res = tokio::time::timeout(ADDON_TIMEOUT, client.subtitles(&a.manifest_url, &ty, &video_id)).await;
        (a.manifest.name.clone(), res)
    }))
    .await;
    Ok(results
        .into_iter()
        .filter_map(|(addon, res)| Some((addon, res.ok()?.ok()?)))
        .flat_map(|(addon, subs)| {
            subs.into_iter().map(move |s| SubtitleOption { id: s.id, url: s.url, lang: s.lang, addon: addon.clone() })
        })
        .collect())
}

/// Download a subtitle file and return it as WebVTT. Done in Rust so CORS and
/// SRT/encoding quirks never reach the UI.
#[tauri::command]
pub async fn subtitle_vtt(state: State<'_, AppState>, url: String) -> Result<String> {
    let bytes = state.addons.fetch_bytes(&url).await?;
    Ok(polar_addon::subs::to_vtt(&bytes))
}

// --- Seek previews (Seekr) -------------------------------------------------

/// Thumbnail track for the seek bar, or `None` when the feature is off, no key
/// is set, or the title has no previews.
#[tauri::command]
pub async fn seek_previews(
    state: State<'_, AppState>,
    video_id: String,
    duration_ms: u64,
) -> Result<Option<crate::seekr::PreviewTrack>> {
    let key = {
        let settings = &state.store.lock().unwrap().data.settings;
        settings.seekr_key.clone().filter(|k| settings.seek_previews && !k.trim().is_empty())
    };
    let Some(key) = key else { return Ok(None) };
    state.seekr.track(key.trim(), &video_id, duration_ms).await.map_err(CmdError::Other)
}

/// The key's tier (e.g. `free_preview`) if Seekr accepts it, else `None`.
#[tauri::command]
pub async fn seekr_validate(state: State<'_, AppState>, key: String) -> Result<Option<String>> {
    state.seekr.validate(key.trim()).await.map_err(CmdError::Other)
}

// --- Skip segments (IntroDB) -------------------------------------------------

/// Intro / recap / credits timings for a movie (`tt…`) or episode (`tt…:s:e`).
#[tauri::command]
pub async fn skip_segments(state: State<'_, AppState>, video_id: String) -> Result<crate::introdb::Segments> {
    state.introdb.segments(&video_id).await.map_err(CmdError::Other)
}

// --- External links ------------------------------------------------------

/// Opens a web page (e.g. a title on IMDb) in the default browser. Only
/// https links, so the webview can't use this to launch anything else.
#[tauri::command]
pub fn open_external(app: tauri::AppHandle, url: String) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    if !url.starts_with("https://") {
        return Err(CmdError::Other("only https links can be opened".into()));
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| CmdError::Other(e.to_string()))
}
