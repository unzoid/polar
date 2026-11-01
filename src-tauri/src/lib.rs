mod commands;
mod player;
mod introdb;
mod seekr;
mod store;
mod sync;

use std::sync::{Arc, Mutex, RwLock};

use rustio_addon::AddonClient;
use rustio_index::{IndexConfig, Indexer};
use tauri::Manager;

pub struct AppState {
    /// Swapped wholesale when the TMDB key changes.
    pub indexer: RwLock<Arc<Indexer>>,
    pub addons: AddonClient,
    pub store: Mutex<store::Store>,
    pub seekr: seekr::Seekr,
    pub mpv: player::Mpv,
    pub introdb: introdb::IntroDb,
}

impl AppState {
    pub fn indexer(&self) -> Arc<Indexer> {
        self.indexer.read().unwrap().clone()
    }
}

pub fn index_config(settings: &store::Settings) -> IndexConfig {
    IndexConfig {
        tmdb_key: settings
            .tmdb_key
            .clone()
            .or_else(|| std::env::var("TMDB_API_KEY").ok()),
        language: Some(settings.language.clone()),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let path = app.path().app_data_dir()?.join("rustio.json");
            let store = store::Store::load(path);
            let indexer = Indexer::new(index_config(&store.data.settings));
            app.manage(AppState {
                indexer: RwLock::new(Arc::new(indexer)),
                addons: AddonClient::new(),
                store: Mutex::new(store),
                seekr: seekr::Seekr::default(),
                mpv: player::Mpv::default(),
                introdb: introdb::IntroDb::default(),
            });
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
            commands::addons_list,
            commands::addon_install,
            commands::addon_remove,
            commands::library_list,
            commands::library_toggle,
            commands::progress_for,
            commands::progress_save,
            commands::continue_watching,
            commands::settings_get,
            commands::settings_set,
            commands::open_external,
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
            player::mpv_stop,
            player::mpv_snapshot,
        ])
        .build(tauri::generate_context!())
        .expect("error while building rustio")
        .run(|app, event| {
            // Never leave an orphaned mpv behind.
            if let tauri::RunEvent::Exit = event {
                app.state::<AppState>().mpv.kill();
            }
        });
}

