#[cfg(any(windows, test))]
mod automation;
mod commands;
mod controllers;
mod discord;
mod downloads;
mod imdb;
mod introdb;
mod keychain;
mod locks;
mod logging;
mod native_dialogs;
mod native_tabs;
mod player;
mod ratings;
mod seekr;
mod store;
mod streamcheck;
mod sync;
mod torrent;
mod trailers;

use std::sync::{Arc, Mutex, RwLock};

use polar_addon::AddonClient;
use polar_index::{IndexConfig, Indexer};
use polar_library::saver::{write_atomic, Saver};
use tauri::Manager;

use crate::locks::{Locked, ReadWrite};

pub struct AppState {
    /// Swapped wholesale when the TMDB key changes.
    pub indexer: RwLock<Arc<Indexer>>,
    pub addons: AddonClient,
    /// Subtitle URLs the addons listed: the only ones `subtitle_vtt` fetches.
    pub subtitle_urls: polar_addon::offered::Offered,
    /// Change it through [`AppState::persist`], which gets it written.
    pub store: Arc<Mutex<store::Store>>,
    /// Writes `store` to disk in the background.
    pub saver: Saver,
    pub seekr: seekr::Seekr,
    pub mpv: player::Mpv,
    pub introdb: introdb::IntroDb,
    pub ratings: ratings::RatingsClient,
    /// Filler and recap episodes, cached in the app's cache folder.
    pub fillers: polar_anime::Fillers,
    /// Anime id mappings for when ani.zip is down, in the same folder.
    pub anime_lists: polar_anime::AnimeLists,
}

impl AppState {
    pub fn indexer(&self) -> Arc<Indexer> {
        self.indexer.reading().clone()
    }

    /// Changes the store and has it written within [`SAVE_DELAY`]. The change
    /// stays in memory either way; the error says it may not reach the disk
    /// (read-only session, or the last write failed).
    pub fn persist(&self, f: impl FnOnce(&mut store::Data)) -> commands::Result<()> {
        self.change(f, false)
    }

    /// [`Self::persist`] for a change someone made (a setting, the library, an
    /// add-on): written at once instead of within [`SAVE_DELAY`], so it isn't
    /// lost if the app is ended right after. Progress and sync keep the delay.
    pub fn persist_now(&self, f: impl FnOnce(&mut store::Data)) -> commands::Result<()> {
        self.change(f, true)
    }

    fn change(&self, f: impl FnOnce(&mut store::Data), now: bool) -> commands::Result<()> {
        let problem = {
            let mut store = self.store.locked();
            f(&mut store.data);
            store.problem().map(str::to_owned)
        };
        if let Some(problem) = problem {
            return Err(commands::CmdError::Save(format!("could not save: not saved: {problem}")));
        }
        if now {
            self.saver.mark_now();
        } else {
            self.saver.mark();
        }
        match self.saver.error() {
            Some(e) => Err(commands::CmdError::Save(format!("could not save: {e}"))),
            None => Ok(()),
        }
    }
}

/// How long changes gather before `polarity.json` is written: the player saves
/// progress every 5 s, so at most one write each time.
const SAVE_DELAY: std::time::Duration = std::time::Duration::from_secs(1);

/// The background writer for `store`: encodes under the lock (no disk I/O
/// there), writes outside it.
fn store_saver(store: Arc<Mutex<store::Store>>) -> Saver {
    Saver::spawn(SAVE_DELAY, move || {
        let (path, bytes) = {
            // A panic elsewhere mid-change still leaves data worth keeping.
            let store = store.locked();
            (store.path().to_owned(), store.encode()?)
        };
        write_atomic(&path, &bytes).map_err(|e| {
            tracing::warn!("{} wasn't saved: {e}", path.display());
            e.to_string()
        })
    })
}

pub fn index_config(settings: &store::Settings) -> IndexConfig {
    IndexConfig {
        tmdb_key: settings.tmdb_key.clone().or_else(|| std::env::var("TMDB_API_KEY").ok()),
        language: Some(settings.language.clone()),
    }
}

/// The data file, `polarity.json` (#40): taken over once from `polar.json`, its name before. While
/// that can't be done (the old file can't be read, the disk is full), the old one stays in use.
fn data_file(dir: &std::path::Path) -> std::path::PathBuf {
    let (path, done) = polar_library::moved::take_over_or_keep(&dir.join("polar.json"), &dir.join("polarity.json"));
    match done {
        Ok(polar_library::moved::TakeOver::Nothing) => {}
        Ok(_) => tracing::info!("polar.json is now polarity.json"),
        Err(e) => tracing::warn!("couldn't rename polar.json to polarity.json, next start tries again: {e}"),
    }
    path
}

/// The app used to be called Rustio (identifier `app.rustio.desktop`); bring
/// its data file over the first time Polarity starts.
fn migrate_legacy_store(dir: &std::path::Path, path: &std::path::Path) {
    if path.exists() {
        return;
    }
    let Some(old) = dir.parent().map(|p| p.join("app.rustio.desktop").join("rustio.json")) else {
        return;
    };
    if old.exists() {
        let _ = std::fs::create_dir_all(dir);
        let _ = std::fs::copy(old, path);
    }
}

/// Addons that come with the app: subtitles work out of the box.
pub(crate) const BUNDLED_ADDONS: &[&str] = &["https://opensubtitles-v3.strem.io/manifest.json"];

/// Install each bundled addon the first time the app runs with it. Offline
/// launches try again next time; one the user has removed stays removed.
async fn install_bundled_addons(app: tauri::AppHandle) {
    let state = app.state::<AppState>();
    let pending: Vec<&str> = {
        let store = state.store.locked();
        BUNDLED_ADDONS.iter().copied().filter(|url| !store.data.bundled_addons.iter().any(|u| u == url)).collect()
    };
    for url in pending {
        let manifest = match state.addons.manifest(url).await {
            Ok(m) => m,
            Err(e) => {
                tracing::info!("bundled add-on not installed yet, next launch tries again: {e}");
                continue;
            }
        };
        let saved = state.persist(|data| {
            if !data.addons.iter().any(|a| a.manifest.id == manifest.id) {
                data.addons.push(store::InstalledAddon { manifest_url: url.into(), manifest });
            }
            data.bundled_addons.push(url.into());
        });
        if let Err(e) = saved {
            tracing::warn!("bundled add-on not saved: {e}");
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            logging::init(&app.path().app_log_dir()?, app.path().home_dir().ok().as_deref());
            tracing::info!("Polarity {} starting", app.package_info().version);
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            let dir = app.path().app_data_dir()?;
            let path = data_file(&dir);
            migrate_legacy_store(&dir, &path);
            downloads::manage(app.handle(), &dir)?;
            let store = Arc::new(Mutex::new(store::Store::load(path)));
            let cache = app.path().app_cache_dir()?;
            #[cfg(target_os = "android")]
            {
                player::set_scratch_dir(cache.join("mpv"));
                player::preload();
            }
            let indexer = Indexer::new(index_config(&store.locked().data.settings));
            app.manage(AppState {
                indexer: RwLock::new(Arc::new(indexer)),
                addons: AddonClient::new(),
                subtitle_urls: Default::default(),
                saver: store_saver(store.clone()),
                store,
                seekr: seekr::Seekr::default(),
                mpv: player::Mpv::default(),
                introdb: introdb::IntroDb::default(),
                ratings: ratings::RatingsClient::default(),
                fillers: polar_anime::Fillers::new(cache.clone()),
                anime_lists: polar_anime::AnimeLists::new(cache.clone()),
            });
            #[cfg(desktop)]
            torrent::manage(app.handle(), cache);
            app.manage(controllers::Controllers::default());
            controllers::watch(app.handle().clone());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move { install_bundled_addons(handle).await });
            #[cfg(windows)]
            automation::create_main_window(app)?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::store_problem,
            commands::catalog,
            commands::recommend,
            commands::search,
            commands::meta,
            commands::streams,
            commands::resolve_stream,
            torrent::torrent_open,
            torrent::torrent_close,
            commands::subtitles,
            commands::subtitle_vtt,
            commands::seek_previews,
            commands::seekr_validate,
            commands::skip_segments,
            commands::ratings,
            commands::addons_list,
            commands::addons_bundled,
            commands::addon_install,
            commands::addon_remove,
            commands::library_list,
            commands::library_toggle,
            commands::progress_for,
            commands::progress_save,
            commands::progress_save_many,
            commands::library_import,
            commands::continue_watching,
            commands::watch_history,
            commands::link_anime,
            commands::anime_links,
            commands::settings_get,
            commands::settings_set,
            commands::settings_reset,
            commands::settings_defaults,
            commands::open_external,
            commands::anime_episode_flags,
            commands::anime_ids,
            commands::anime_cache,
            commands::anime_cache_clear,
            commands::trailer,
            keychain::keychain_get,
            keychain::keychain_set,
            keychain::keychain_delete,
            downloads::downloads_list,
            downloads::download_start,
            downloads::download_pause,
            downloads::download_resume,
            downloads::download_remove,
            downloads::download_reveal,
            controllers::controllers_list,
            sync::space_activate,
            sync::space_import_local,
            sync::space_forget,
            sync::sync_changes,
            sync::sync_mark_pushed,
            sync::sync_apply,
            sync::space_untitled,
            sync::space_fill_display,
            player::mpv_available,
            player::mpv_load,
            streamcheck::stream_probe,
            streamcheck::stream_ready,
            discord::discord_available,
            discord::discord_presence,
            player::mpv_command,
            player::mpv_set,
            player::mpv_tune,
            player::mpv_stop,
            player::mpv_snapshot,
            player::player_system_bars,
            native_tabs::native_tabs,
            native_dialogs::native_dialog,
            native_dialogs::native_share,
        ])
        .build(tauri::generate_context!())
        .expect("error while building polar")
        .run(|app, event| {
            // Never leave an orphaned mpv behind, nor a change unwritten, nor a torrent cache.
            if let tauri::RunEvent::Exit = event {
                let state = app.state::<AppState>();
                state.mpv.kill();
                state.saver.flush();
                torrent::shutdown(app);
            }
        });
}
