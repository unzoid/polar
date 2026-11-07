//! The IPC surface the UI talks to. Every command is async and never blocks
//! the UI thread; network fan-out happens concurrently.

use std::sync::Arc;
use std::time::Duration;

use futures::future::join_all;
use polar_addon::{rank_asked, Asked, Manifest, Meta, MetaPreview, RankedStream, Stream, WantedEpisode};
use polar_index::Indexer;
use polar_library::AnimeLink;
use serde::Serialize;
use tauri::State;

use crate::downloads::Downloads;
use crate::locks::{Locked, ReadWrite};
use crate::store::{now, InstalledAddon, LibraryItem, Progress, Settings};
use crate::AppState;

/// How a command fails. It crosses IPC as `{ code, message }` (src/lib/errors.ts):
/// `code` for the UI to act on, `message` for people.
#[derive(Debug, thiserror::Error)]
pub enum CmdError {
    #[error(transparent)]
    Index(#[from] polar_index::IndexError),
    #[error(transparent)]
    Addon(#[from] polar_addon::AddonError),
    /// What was asked for isn't there (any more).
    #[error("{0}")]
    NotFound(String),
    /// Not something Polarity does: an id it doesn't key by, a link it won't open.
    #[error("{0}")]
    Unsupported(String),
    /// A web service (Seekr, IntroDB) failed or said no.
    #[error("{0}")]
    Upstream(String),
    /// Writing to disk failed.
    #[error("{0}")]
    Save(String),
    /// The link check found the source won't play; the reason says why.
    #[error("{0}")]
    Source(String),
    /// The player (mpv) didn't start or answer.
    #[error("{0}")]
    Player(String),
    #[error("{0}")]
    Other(String),
}

impl CmdError {
    pub fn code(&self) -> &'static str {
        use polar_addon::AddonError;
        use polar_index::IndexError;
        match self {
            CmdError::Index(IndexError::NotFound) | CmdError::NotFound(_) => "not_found",
            CmdError::Index(IndexError::UnsupportedId(_)) | CmdError::Unsupported(_) => "unsupported",
            CmdError::Index(IndexError::Upstream(_)) | CmdError::Upstream(_) => "upstream",
            CmdError::Addon(AddonError::Http(_)) => "network",
            CmdError::Addon(AddonError::Decode(_)) => "bad_answer",
            CmdError::Save(_) => "save_failed",
            CmdError::Source(_) => "source",
            CmdError::Player(_) => "player",
            CmdError::Other(_) => "other",
        }
    }
}

impl Serialize for CmdError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut e = s.serialize_struct("CmdError", 2)?;
        e.serialize_field("code", self.code())?;
        e.serialize_field("message", &self.to_string())?;
        e.end()
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

/// One page of an installed addon's catalog (#206), its extra arguments
/// (`genre`, `skip`, `search`) as the manifest declares them. A catalog the
/// manifest doesn't list, or an argument it doesn't take, is refused.
#[tauri::command]
pub async fn addon_catalog(
    state: State<'_, AppState>,
    addon: String,
    ty: String,
    id: String,
    extra: Vec<(String, String)>,
) -> Result<Vec<MetaPreview>> {
    let found = installed(&state).into_iter().find(|a| a.manifest.id == addon);
    let addon = found.ok_or_else(|| CmdError::NotFound("that add-on isn't installed".into()))?;
    let declared = addon.manifest.catalogs.iter().find(|c| c.ty == ty && c.id == id);
    if !declared.is_some_and(|c| c.accepts(&extra)) || extra.iter().any(|(_, v)| v.len() > 200) {
        return Err(CmdError::Unsupported("the add-on doesn't offer that list".into()));
    }
    let args: Vec<(&str, &str)> = extra.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
    let fetch = state.addons.catalog(&addon.manifest_url, &ty, &id, &args);
    match tokio::time::timeout(ADDON_TIMEOUT, fetch).await {
        Ok(page) => Ok(page?),
        Err(_) => Err(CmdError::Upstream(format!("{} took too long to answer", addon.manifest.name))),
    }
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
        .ok_or_else(|| CmdError::Unsupported(format!("no addon provides metadata for {id}")))?;
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
    /// Sources left out by the filters in Settings → Sources.
    hidden: usize,
}

/// Query every installed stream addon concurrently, then rank and dedupe.
#[tauri::command]
pub async fn streams(
    state: State<'_, AppState>,
    ty: String,
    video_id: String,
    // Other ids for the same episode (an anime's Kitsu id): asked of every addon that serves them, results merged.
    alt_ids: Option<Vec<String>>,
    // The episode's absolute number(s), when the app knows them (an anime's): a file numbered that way is this episode.
    absolute: Option<Vec<u32>>,
) -> Result<StreamsResult> {
    let mut ids = vec![video_id];
    ids.extend(alt_ids.unwrap_or_default());
    // What every file is checked against: another episode's file is listed last and never picked by itself.
    let wanted = WantedEpisode::from_ids(ids.iter().map(String::as_str), &absolute.unwrap_or_default());

    // One request per (addon, id) the addon claims to serve.
    let jobs: Vec<(InstalledAddon, String)> = installed(&state)
        .into_iter()
        .flat_map(|a| {
            ids.iter()
                .filter(|id| a.manifest.serves("stream", &ty, id))
                .map(|id| (a.clone(), id.clone()))
                .collect::<Vec<_>>()
        })
        .collect();

    let client = &state.addons;
    let kind = ty.as_str();
    let results = join_all(jobs.iter().map(|(a, id)| async move {
        let fetch = client.streams(&a.manifest_url, kind, id);
        let res = tokio::time::timeout(ADDON_TIMEOUT, fetch).await;
        (a, id, res)
    }))
    .await;

    // Add-ons go by their manifest URL here: two may share a name (L22).
    let mut all = Vec::new();
    let mut failed: Vec<&InstalledAddon> = Vec::new();
    let mut answered = std::collections::HashSet::new();
    for (a, id, res) in results {
        match res {
            Ok(Ok(streams)) => {
                answered.insert(&a.manifest_url);
                all.extend(streams.into_iter().map(|stream| Asked {
                    addon: a.manifest.name.clone(),
                    request: Some(id.clone()),
                    stream,
                }));
            }
            _ => failed.push(a),
        }
    }
    // An addon that answered for one of the ids isn't "failed" because it timed out on another,
    // and one that failed for two ids is named once.
    let mut named = std::collections::HashSet::new();
    let failed: Vec<String> = failed
        .into_iter()
        .filter(|a| !answered.contains(&a.manifest_url) && named.insert(&a.manifest_url))
        .map(|a| a.manifest.name.clone())
        .collect();
    let filter = state.store.locked().data.settings.stream_filter(&ty);
    let (streams, hidden) = rank_asked(all, &filter, wanted.as_ref());
    Ok(StreamsResult { streams, failed, hidden })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Playable {
    /// Plays in the built-in player.
    Url {
        url: String,
    },
    /// A torrent from the user's add-on: the player opens it with `torrent_open`.
    Torrent {},
    /// Needs a browser (e.g. YouTube trailers, "watch on" links).
    External {
        url: String,
    },
    Unsupported {
        reason: String,
    },
}

/// Turn a stream into something playable: a link, a torrent, or a YouTube video opened outside.
#[tauri::command]
pub fn resolve_stream(stream: Stream) -> Result<Playable> {
    Ok(resolve(stream))
}

/// Shared by playback and downloads.
pub fn resolve(stream: Stream) -> Playable {
    if let Some(url) = stream.url {
        // A download played back: a path on this machine, which may have been deleted since.
        if crate::downloads::is_local(&url) && !std::path::Path::new(&url).exists() {
            return Playable::Unsupported { reason: "This download is no longer on this device.".into() };
        }
        return Playable::Url { url };
    }
    if stream.info_hash.is_some() {
        return Playable::Torrent {};
    }
    if let Some(yt) = stream.yt_id {
        // An add-on's id goes into a link the system opens: only a real video id gets through (L13).
        if !is_youtube_id(&yt) {
            return Playable::Unsupported { reason: "This stream's YouTube id isn't valid.".into() };
        }
        return Playable::External { url: format!("https://www.youtube.com/watch?v={yt}") };
    }
    if let Some(url) = stream.external_url {
        return Playable::External { url };
    }
    Playable::Unsupported { reason: "This stream has no playable source.".into() }
}

// --- Addons --------------------------------------------------------------

fn installed(state: &State<'_, AppState>) -> Vec<InstalledAddon> {
    state.store.locked().data.addons.clone()
}

#[tauri::command]
pub fn addons_list(state: State<'_, AppState>) -> Vec<InstalledAddon> {
    installed(&state)
}

/// The manifest URLs of the add-ons the app installs itself: a profile new to this device keeps
/// them when it starts without anyone else's add-ons (#80).
#[tauri::command]
pub fn addons_bundled() -> Vec<String> {
    crate::BUNDLED_ADDONS.iter().map(|u| u.to_string()).collect()
}

/// An add-on's manifest, read but not installed: what an install link from outside asks the user
/// to confirm (#163). Only `https://` addresses, the only kind those links stand for.
#[tauri::command]
pub async fn addon_preview(state: State<'_, AppState>, url: String) -> Result<Manifest> {
    if !url.starts_with("https://") || !(url.ends_with("/manifest.json") || url.contains("/manifest.json?")) {
        return Err(CmdError::Unsupported("Not an add-on's address".into()));
    }
    Ok(state.addons.manifest(&url).await?)
}

#[tauri::command]
pub async fn addon_install(state: State<'_, AppState>, url: String) -> Result<InstalledAddon> {
    let url = url.trim().replace("stremio://", "https://");
    let manifest_url =
        if url.ends_with("/manifest.json") { url } else { format!("{}/manifest.json", url.trim_end_matches('/')) };
    let mut manifest = state.addons.manifest(&manifest_url).await?;
    manifest.behavior_hints.get_or_insert_with(Default::default);
    let addon = InstalledAddon { manifest_url, manifest };
    let saved = addon.clone();
    state.persist_now(|d| {
        // Reinstalling (or reconfiguring) keeps the addon's place in the order.
        match d.addons.iter_mut().find(|a| a.manifest.id == saved.manifest.id) {
            Some(slot) => *slot = saved,
            None => d.addons.push(saved),
        }
    })?;
    Ok(addon)
}

#[tauri::command]
pub fn addon_remove(state: State<'_, AppState>, id: String) -> Result<()> {
    state.persist_now(|d| d.addons.retain(|a| a.manifest.id != id))
}

// --- Library & progress --------------------------------------------------

// Everything here acts on the active space (the signed-out "local" space or
// the selected profile), see `store::Space`.

#[tauri::command]
pub fn library_list(state: State<'_, AppState>) -> Vec<LibraryItem> {
    let store = state.store.locked();
    store.data.space().map(|s| s.library_list()).unwrap_or_default()
}

/// Returns whether the item is in the library afterwards.
#[tauri::command]
pub fn library_toggle(state: State<'_, AppState>, item: MetaPreview) -> Result<bool> {
    let item =
        LibraryItem { id: item.id, ty: item.ty, name: item.name, poster: item.poster, added_at: 0, updated_at: 0 };
    let mut added = false;
    state.persist_now(|d| added = d.space_mut().library_toggle(item, now()))?;
    Ok(added)
}

/// All progress entries for one title (every episode of a series), under
/// any of its ids.
#[tauri::command]
pub fn progress_for(state: State<'_, AppState>, meta_id: String) -> Vec<Progress> {
    let store = state.store.locked();
    store.data.space().map(|s| s.progress_for(&meta_id)).unwrap_or_default()
}

#[tauri::command]
pub fn progress_save(state: State<'_, AppState>, progress: Progress) -> Result<()> {
    state.persist(|d| d.space_mut().progress_save(vec![progress], now()))
}

/// Several entries in one save (marking a whole show watched). They count as
/// touched in the order given, so the last one is the title's latest.
#[tauri::command]
pub fn progress_save_many(state: State<'_, AppState>, progress: Vec<Progress>) -> Result<()> {
    state.persist(|d| d.space_mut().progress_save(progress, now()))
}

/// What was added by [`library_import`].
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    pub library: usize,
    pub progress: usize,
}

/// Library items and progress exported by another app, with their own times
/// (`Space::import_exported`): nothing newer here is overwritten, and importing the same
/// file again adds nothing.
#[tauri::command]
pub fn library_import(
    state: State<'_, AppState>,
    library: Vec<LibraryItem>,
    progress: Vec<Progress>,
) -> Result<Imported> {
    let mut added = (0, 0);
    state.persist_now(|d| added = d.space_mut().import_exported(library, progress, now()))?;
    Ok(Imported { library: added.0, progress: added.1 })
}

/// Latest unfinished video per title, newest first.
#[tauri::command]
pub fn continue_watching(state: State<'_, AppState>) -> Vec<Progress> {
    let store = state.store.locked();
    let watched = store.data.settings.watched_fraction();
    store.data.space().map(|s| s.continue_watching(watched)).unwrap_or_default()
}

/// Everything you've watched: the latest video per title — finished or well
/// under way — newest first. The Library's "Watched" shelf.
#[tauri::command]
pub fn watch_history(state: State<'_, AppState>) -> Vec<Progress> {
    let store = state.store.locked();
    let watched = store.data.settings.watched_fraction();
    store.data.space().map(|s| s.watch_history(watched)).unwrap_or_default()
}

/// Records which id an anime is played from, and moves library items and
/// progress kept under its other ids onto that one (docs/anime-identity.md).
/// `updatedAt` is set here. Returns whether anything changed: the anime
/// pages call this on every visit, and a link that says what the stored one
/// already does keeps the stored one's time (so sync has nothing to send).
/// A link the anime id lists already give, for a show with nothing kept
/// under its ids yet, isn't stored at all (#102, `Space::needs_link`).
#[tauri::command]
pub async fn link_anime(state: State<'_, AppState>, mut link: AnimeLink) -> Result<bool> {
    if !link.is_valid() {
        return Err(CmdError::Unsupported(format!("not a title id Polarity keys by: {}", link.canonical)));
    }
    // What the anime id lists say (none when they can't be read: then the link is kept).
    let listed = state.anime_lists.find(&polar_anime::AnimeKey::Anilist(link.anilist)).await.and_then(|m| m.imdb_id);
    let skip = {
        let store = state.store.locked();
        store.data.space().is_some_and(|s| {
            s.links.get(&link.anilist).is_some_and(|old| old.same_target(&link))
                || !s.needs_link(&link, listed.as_deref())
        })
    };
    if skip {
        return Ok(false);
    }
    link.updated_at = now();
    let mut changed = false;
    state.persist(|d| changed = d.space_mut().link_anime(link))?;
    Ok(changed)
}

/// The anime links of the active space.
#[tauri::command]
pub fn anime_links(state: State<'_, AppState>) -> Vec<AnimeLink> {
    let store = state.store.locked();
    store.data.space().map(|s| s.links.values().cloned().collect()).unwrap_or_default()
}

// --- Settings ------------------------------------------------------------

/// Why a data file couldn't be read at start-up, if one couldn't: changes
/// then last only until the app quits, and the app says so (critique C1).
#[tauri::command]
pub fn store_problem(state: State<'_, AppState>, downloads: State<'_, Arc<Downloads>>) -> Option<String> {
    let store = state.store.locked().problem().map(str::to_owned);
    store.or_else(|| downloads.problem().map(str::to_owned))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsView {
    #[serde(flatten)]
    settings: Settings,
    metadata_source: &'static str,
}

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> SettingsView {
    let settings = state.store.locked().data.settings.clone();
    SettingsView { settings, metadata_source: state.indexer().source() }
}

#[tauri::command]
pub fn settings_set(state: State<'_, AppState>, settings: Settings) -> Result<SettingsView> {
    let rebuild = {
        let store = state.store.locked();
        store.data.settings.tmdb_key != settings.tmdb_key || store.data.settings.language != settings.language
    };
    if rebuild {
        *state.indexer.writing() = Arc::new(Indexer::new(crate::index_config(&settings)));
    }
    let next = settings.clone();
    state.persist_now(|d| d.settings = next)?;
    Ok(SettingsView { settings, metadata_source: state.indexer().source() })
}

/// What every setting is until someone changes it: settings sync sends only
/// the ones that differ (docs/supabase-storage.md §3.3).
#[tauri::command]
pub fn settings_defaults() -> Settings {
    Settings::default()
}

/// Everything back to the defaults, except what took effort to set up: API
/// keys and the metadata language.
#[tauri::command]
pub fn settings_reset(state: State<'_, AppState>) -> Result<SettingsView> {
    let current = state.store.locked().data.settings.clone();
    let fresh = Settings {
        tmdb_key: current.tmdb_key,
        seekr_key: current.seekr_key,
        mdblist_key: current.mdblist_key,
        omdb_key: current.omdb_key,
        language: current.language,
        ..Settings::default()
    };
    settings_set(state, fresh)
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

/// External subtitles from every installed addon that serves them. `video_size` and `filename`
/// are the playing stream's hints, when it has them: add-ons match subtitles to the file by them.
#[tauri::command]
pub async fn subtitles(
    state: State<'_, AppState>,
    ty: String,
    video_id: String,
    video_size: Option<u64>,
    filename: Option<String>,
) -> Result<Vec<SubtitleOption>> {
    let addons: Vec<InstalledAddon> =
        installed(&state).into_iter().filter(|a| a.manifest.serves("subtitles", &ty, &video_id)).collect();
    let client = &state.addons;
    let file = polar_addon::VideoFile {
        size: video_size.filter(|n| *n > 0),
        name: filename.map(|n| n.trim().to_owned()).filter(|n| !n.is_empty()),
    };
    let file = &file;
    let results = join_all(addons.iter().map(|a| async {
        let res = tokio::time::timeout(ADDON_TIMEOUT, client.subtitles(&a.manifest_url, &ty, &video_id, file)).await;
        (a.manifest.name.clone(), res)
    }))
    .await;
    let options: Vec<SubtitleOption> = results
        .into_iter()
        .filter_map(|(addon, res)| Some((addon, res.ok()?.ok()?)))
        .flat_map(|(addon, subs)| {
            subs.into_iter().map(move |s| SubtitleOption { id: s.id, url: s.url, lang: s.lang, addon: addon.clone() })
        })
        .collect();
    state.subtitle_urls.offer(options.iter().map(|o| o.url.as_str()));
    Ok(options)
}

/// Download a subtitle file and return it as WebVTT. Done in Rust so CORS and
/// SRT/encoding quirks never reach the UI; for that same reason only a URL
/// `subtitles` listed, so the page can't read the LAN or this machine (M13).
#[tauri::command]
pub async fn subtitle_vtt(state: State<'_, AppState>, url: String) -> Result<String> {
    if !state.subtitle_urls.was_offered(&url) {
        return Err(CmdError::Unsupported("not a subtitle an addon offered".into()));
    }
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
        let settings = &state.store.locked().data.settings;
        settings.seekr_key.clone().filter(|k| settings.seek_previews && !k.trim().is_empty())
    };
    let Some(key) = key else { return Ok(None) };
    state.seekr.track(key.trim(), &video_id, duration_ms).await.map_err(CmdError::Upstream)
}

/// The key's tier (e.g. `free_preview`) if Seekr accepts it, else `None`.
#[tauri::command]
pub async fn seekr_validate(state: State<'_, AppState>, key: String) -> Result<Option<String>> {
    state.seekr.validate(key.trim()).await.map_err(CmdError::Upstream)
}

// --- Skip segments (IntroDB) -------------------------------------------------

/// Intro / recap / credits timings for a movie (`tt…`) or episode (`tt…:s:e`).
#[tauri::command]
pub async fn skip_segments(state: State<'_, AppState>, video_id: String) -> Result<crate::introdb::Segments> {
    state.introdb.segments(&video_id).await.map_err(CmdError::Upstream)
}

// --- Ratings (MDBList / OMDb) ----------------------------------------------

/// Rotten Tomatoes, Metacritic, Letterboxd… scores for a title, from whichever
/// ratings services have a key in Settings → Services. Empty without one.
#[tauri::command]
pub async fn ratings(state: State<'_, AppState>, ty: String, id: String) -> Result<crate::ratings::Ratings> {
    let (mdblist, omdb) = {
        let s = &state.store.locked().data.settings;
        let key = |k: &Option<String>| k.as_deref().map(str::trim).filter(|k| !k.is_empty()).map(str::to_owned);
        (key(&s.mdblist_key), key(&s.omdb_key))
    };
    Ok(state.ratings.get(&id, &ty, mdblist.as_deref(), omdb.as_deref()).await)
}

// --- External links ------------------------------------------------------

/// A title's trailer as a playable file (IMDb), or none.
#[tauri::command]
pub async fn trailer(imdb_id: String) -> Option<crate::trailers::Trailer> {
    crate::trailers::imdb_trailer(&imdb_id).await
}

/// An anime's filler and recap episodes by MAL id (Jikan, then
/// animefillerlist.com by `slugs`), cached on disk for a day.
#[tauri::command]
pub async fn anime_episode_flags(
    state: State<'_, AppState>,
    mal_id: u32,
    slugs: Vec<String>,
) -> Result<polar_anime::EpisodeFlags> {
    Ok(state.fillers.get(mal_id, &slugs).await)
}

/// An anime's ids from Fribb/anime-lists, for when ani.zip can't be reached:
/// `key` is `anilist_id`, `mal_id`, `kitsu_id` or `imdb_id`, as ani.zip takes them.
#[tauri::command]
pub async fn anime_ids(
    state: State<'_, AppState>,
    key: String,
    value: String,
) -> Result<Option<polar_anime::AnimeMapping>> {
    use polar_anime::AnimeKey;
    let num = || value.parse::<u32>().ok();
    let key = match key.as_str() {
        "anilist_id" => num().map(AnimeKey::Anilist),
        "mal_id" => num().map(AnimeKey::Mal),
        "kitsu_id" => num().map(AnimeKey::Kitsu),
        "imdb_id" => Some(AnimeKey::Imdb(value.clone())),
        _ => None,
    };
    let Some(key) = key else { return Ok(None) };
    Ok(state.anime_lists.find(&key).await)
}

#[derive(Serialize)]
pub struct CacheInfo {
    path: String,
    bytes: u64,
}

/// The anime cache folder and the size of what the app keeps there, for Settings.
#[tauri::command]
pub async fn anime_cache(state: State<'_, AppState>) -> Result<CacheInfo> {
    let dir = state.fillers.path().parent().map(|d| d.display().to_string()).unwrap_or_default();
    Ok(CacheInfo { path: dir, bytes: state.fillers.size().await + state.anime_lists.size().await })
}

/// Deletes the anime cache files; they are fetched again when next needed.
#[tauri::command]
pub async fn anime_cache_clear(state: State<'_, AppState>) -> Result<()> {
    state.fillers.clear().await;
    state.anime_lists.clear().await;
    Ok(())
}

/// Opens a web page (e.g. a title on IMDb) in the default browser. Only
/// https links, so the webview can't use this to launch anything else.
#[tauri::command]
pub fn open_external(app: tauri::AppHandle, url: String) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    if !url.starts_with("https://") {
        return Err(CmdError::Unsupported("only https links can be opened".into()));
    }
    app.opener().open_url(url, None::<&str>).map_err(|e| CmdError::Other(e.to_string()))
}

/// Whether the window can be pinned on top of the others (the player's Pin
/// window, #266). Not on Wayland, where most compositors don't let an app
/// keep itself on top; through XWayland (`GDK_BACKEND=x11`) it can.
#[tauri::command]
pub fn window_can_pin() -> bool {
    #[cfg(target_os = "linux")]
    {
        let wayland = std::env::var("XDG_SESSION_TYPE").is_ok_and(|s| s.eq_ignore_ascii_case("wayland"))
            || std::env::var_os("WAYLAND_DISPLAY").is_some();
        let x11 = std::env::var("GDK_BACKEND").is_ok_and(|b| b.starts_with("x11"));
        !wayland || x11
    }
    #[cfg(not(target_os = "linux"))]
    {
        true
    }
}

// Inside this module so it can build the result types above, whose fields are private.
#[cfg(test)]
#[path = "contract.rs"]
mod contract;

/// YouTube video ids: 11 characters of letters, digits, `-` and `_`.
fn is_youtube_id(id: &str) -> bool {
    id.len() == 11 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

#[cfg(test)]
mod youtube_tests {
    use super::is_youtube_id;

    #[test]
    fn only_real_video_ids_pass() {
        assert!(is_youtube_id("dQw4w9WgXcQ"));
        assert!(is_youtube_id("a-b_c-d_e-f"));
        assert!(!is_youtube_id("dQw4w9WgXc"));
        assert!(!is_youtube_id("dQw4w9WgXcQ&list=x"));
        assert!(!is_youtube_id("dQw4w9WgX/Q"));
    }
}
