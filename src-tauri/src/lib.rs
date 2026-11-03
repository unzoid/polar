mod commands;
mod controllers;
mod downloads;
mod fillers;
mod imdb;
mod introdb;
mod player;
mod ratings;
mod seekr;
mod store;
mod streamcheck;
mod sync;
mod trailers;

use std::sync::{Arc, Mutex, RwLock};

use polar_addon::AddonClient;
use polar_index::{IndexConfig, Indexer};
use tauri::Manager;

pub struct AppState {
    /// Swapped wholesale when the TMDB key changes.
    pub indexer: RwLock<Arc<Indexer>>,
    pub addons: AddonClient,
    pub store: Mutex<store::Store>,
    pub seekr: seekr::Seekr,
    pub mpv: player::Mpv,
    pub introdb: introdb::IntroDb,
    pub ratings: ratings::RatingsClient,
}

impl AppState {
    pub fn indexer(&self) -> Arc<Indexer> {
        self.indexer.read().unwrap().clone()
    }
}

pub fn index_config(settings: &store::Settings) -> IndexConfig {
    IndexConfig {
        tmdb_key: settings.tmdb_key.clone().or_else(|| std::env::var("TMDB_API_KEY").ok()),
        language: Some(settings.language.clone()),
    }
}

/// The app used to be called Rustio (identifier `app.rustio.desktop`); bring
/// its data file over the first time Polar starts.
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
const BUNDLED_ADDONS: &[&str] = &["https://opensubtitles-v3.strem.io/manifest.json"];

/// Install each bundled addon the first time the app runs with it. Offline
/// launches try again next time; one the user has removed stays removed.
async fn install_bundled_addons(app: tauri::AppHandle) {
    let state = app.state::<AppState>();
    let pending: Vec<&str> = {
        let store = state.store.lock().unwrap();
        BUNDLED_ADDONS.iter().copied().filter(|url| !store.data.bundled_addons.iter().any(|u| u == url)).collect()
    };
    for url in pending {
        let Ok(manifest) = state.addons.manifest(url).await else { continue };
        let mut store = state.store.lock().unwrap();
        let data = &mut store.data;
        if !data.addons.iter().any(|a| a.manifest.id == manifest.id) {
            data.addons.push(store::InstalledAddon { manifest_url: url.into(), manifest });
        }
        data.bundled_addons.push(url.into());
        let _ = store.save();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            let dir = app.path().app_data_dir()?;
            let path = dir.join("polar.json");
            migrate_legacy_store(&dir, &path);
            downloads::manage(app.handle(), &dir);
            let store = store::Store::load(path);
            let indexer = Indexer::new(index_config(&store.data.settings));
            app.manage(AppState {
                indexer: RwLock::new(Arc::new(indexer)),
                addons: AddonClient::new(),
                store: Mutex::new(store),
                seekr: seekr::Seekr::default(),
                mpv: player::Mpv::default(),
                introdb: introdb::IntroDb::default(),
                ratings: ratings::RatingsClient::default(),
            });
            app.manage(controllers::Controllers::default());
            controllers::watch(app.handle().clone());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move { install_bundled_addons(handle).await });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::catalog,
            commands::recommend,
            commands::search,
            commands::meta,
            commands::streams,
            commands::resolve_stream,
            commands::subtitles,
            commands::subtitle_vtt,
            commands::seek_previews,
            commands::seekr_validate,
            commands::skip_segments,
            commands::ratings,
            commands::addons_list,
            commands::addon_install,
            commands::addon_remove,
            commands::library_list,
            commands::library_toggle,
            commands::progress_for,
            commands::progress_save,
            commands::progress_save_many,
            commands::continue_watching,
            commands::watch_history,
            commands::settings_get,
            commands::settings_set,
            commands::settings_reset,
            commands::open_external,
            commands::anime_filler,
            commands::trailer,
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
            player::mpv_available,
            player::mpv_load,
            player::mpv_command,
            player::mpv_set,
            player::mpv_tune,
            player::mpv_stop,
            player::mpv_snapshot,
        ])
        .build(tauri::generate_context!())
        .expect("error while building polar")
        .run(|app, event| {
            // Never leave an orphaned mpv behind.
            if let tauri::RunEvent::Exit = event {
                app.state::<AppState>().mpv.kill();
            }
        });
}
