//! Torrent streams from the user's own add-ons, played through
//! `polar_torrent`'s engine. The engine starts the first time one is played
//! (no peer traffic before that) and keeps its cache in the app's cache
//! folder. Desktop and Android (#207); iOS says it can't.
//!
//! The player calls `torrent_open` instead of using the stream's link, gets
//! a loopback link back, and `torrent_close` when it closes. Each step of
//! opening goes to the loading screen as a `player://torrent` event.
//!
//! On Android the engine never runs unseen: closing the player stops it
//! entirely unless the user keeps sharing, and MainActivity.kt calls
//! `TorrentEngine.background()` once the app has been in the background for
//! a short while, which stops it (and empties the cache) whatever the
//! settings, telling the player with `player://torrent-stopped`.

use polar_addon::Stream;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::commands::CmdError;

/// The user's torrent settings (Settings → Sources), sent with each call.
#[derive(Debug, Clone, Copy, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct TorrentLimits {
    /// 0 = no limit.
    pub cache_gb: f64,
    /// Download cap in megabits per second; 0 = no limit.
    pub download_mbps: f64,
    /// Upload cap in megabits per second; 0 = no limit.
    pub upload_mbps: f64,
    pub keep_sharing: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TorrentLink {
    pub url: String,
    pub size: u64,
}

#[cfg(not(target_os = "ios"))]
mod engine {
    use std::num::NonZeroU32;
    use std::path::PathBuf;
    use std::sync::Arc;

    use polar_torrent::{Engine, Limits};
    use tauri::{AppHandle, Manager};

    use crate::locks::Locked;

    use super::TorrentLimits;

    #[derive(serde::Serialize, Clone)]
    pub struct StepEvent {
        pub id: u32,
        pub step: polar_torrent::Step,
    }

    /// The engine while it runs. Starting and stopping take `turn`, so a new
    /// engine never starts while the last one is still emptying the cache.
    pub struct Torrents {
        dir: PathBuf,
        engine: std::sync::Mutex<Option<Arc<Engine>>>,
        turn: tokio::sync::Mutex<()>,
    }

    pub fn manage(app: &AppHandle, cache: PathBuf) {
        app.manage(Torrents {
            dir: cache.join("torrent-cache"),
            engine: std::sync::Mutex::new(None),
            turn: tokio::sync::Mutex::new(()),
        });
        #[cfg(target_os = "android")]
        let _ = super::android::APP.set(app.clone());
    }

    /// The running engine, started if it isn't.
    pub async fn engine(app: &AppHandle) -> Result<Arc<Engine>, String> {
        let torrents = app.state::<Torrents>();
        let _turn = torrents.turn.lock().await;
        if let Some(engine) = started(app) {
            return Ok(engine);
        }
        let engine =
            Engine::start(torrents.dir.clone()).await.map(Arc::new).map_err(|e| format!("The torrent engine didn't start: {e}"))?;
        *torrents.engine.locked() = Some(engine.clone());
        Ok(engine)
    }

    /// The engine if it runs, without starting it.
    pub fn started(app: &AppHandle) -> Option<Arc<Engine>> {
        app.try_state::<Torrents>()?.engine.locked().clone()
    }

    /// Stop the engine, kept torrents too, and empty its cache; the next
    /// torrent starts a new one. Whether one was running.
    pub async fn stop(app: &AppHandle) -> bool {
        let Some(torrents) = app.try_state::<Torrents>() else { return false };
        let _turn = torrents.turn.lock().await;
        let engine = torrents.engine.locked().take();
        match engine {
            Some(engine) => {
                engine.shutdown().await;
                true
            }
            None => false,
        }
    }

    pub fn limits(l: TorrentLimits) -> Limits {
        let cache_bytes = if l.cache_gb > 0.0 { (l.cache_gb * 1e9) as u64 } else { 0 };
        let bps = |mbps: f64| NonZeroU32::new((mbps * 125_000.0).min(f64::from(u32::MAX)) as u32);
        Limits {
            cache_bytes,
            download_bps: bps(l.download_mbps),
            upload_bps: bps(l.upload_mbps),
            keep_sharing: l.keep_sharing,
        }
    }
}

#[cfg(not(target_os = "ios"))]
pub use engine::manage;

/// Android: the activity's background timer (gen/android MainActivity.kt).
#[cfg(target_os = "android")]
mod android {
    use jni::objects::JObject;
    use jni::JNIEnv;
    use tauri::{AppHandle, Emitter};

    pub static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

    /// The app has been in the background for the grace period: stop the
    /// engine whatever the settings, and tell a player still open.
    #[no_mangle]
    pub extern "system" fn Java_app_getpolar_desktop_TorrentEngine_background<'a>(_env: JNIEnv<'a>, _this: JObject<'a>) {
        let Some(app) = APP.get().cloned() else { return };
        if super::engine::started(&app).is_none() {
            return;
        }
        tauri::async_runtime::spawn(async move {
            // The player hears first, so the dead link's error doesn't send it on to the next source.
            let _ = app.emit("player://torrent-stopped", ());
            if super::engine::stop(&app).await {
                tracing::info!("torrent engine stopped: the app was in the background");
            }
        });
    }
}

/// Start playing `stream`'s torrent (replacing the one playing) and return
/// the link the player opens. Steps go out as `player://torrent` with `step_id`.
#[tauri::command]
pub async fn torrent_open(
    app: AppHandle,
    stream: Stream,
    limits: TorrentLimits,
    step_id: u32,
) -> Result<TorrentLink, CmdError> {
    #[cfg(not(target_os = "ios"))]
    {
        use std::sync::Arc;
        use tauri::Emitter;

        let info_hash = stream.info_hash.ok_or_else(|| CmdError::Unsupported("This source isn't a torrent.".into()))?;
        let request = polar_torrent::Request {
            info_hash,
            file_idx: stream.file_idx.map(|i| i as usize),
            sources: stream.sources.unwrap_or_default(),
        };
        let engine = engine::engine(&app).await.map_err(CmdError::Source)?;
        let emitter = app.clone();
        let on_step: polar_torrent::OnStep = Arc::new(move |step| {
            let _ = emitter.emit("player://torrent", engine::StepEvent { id: step_id, step });
        });
        let opened = engine.open(&request, engine::limits(limits), on_step).await.map_err(CmdError::Source)?;
        Ok(TorrentLink { url: opened.url, size: opened.size })
    }
    #[cfg(target_os = "ios")]
    {
        let _ = (app, stream, limits, step_id);
        Err(CmdError::Unsupported("Torrent sources don't play on iPhone and iPad.".into()))
    }
}

/// The player closed: stop the torrent (and delete its files) unless the
/// user keeps sharing after playback.
#[tauri::command]
pub async fn torrent_close(app: AppHandle, limits: TorrentLimits) {
    #[cfg(target_os = "android")]
    if !limits.keep_sharing {
        // Nothing is kept: the whole engine goes, so it never runs unseen.
        engine::stop(&app).await;
        return;
    }
    #[cfg(not(target_os = "ios"))]
    if let Some(engine) = engine::started(&app) {
        engine.close(engine::limits(limits)).await;
    }
    #[cfg(target_os = "ios")]
    let _ = (app, limits);
}

/// Whether `url` is a link the engine handed out (played as is: no link
/// check, no add-on headers).
pub fn owns(app: &AppHandle, url: &str) -> bool {
    #[cfg(not(target_os = "ios"))]
    return engine::started(app).is_some_and(|e| e.owns(url));
    #[cfg(target_os = "ios")]
    {
        let _ = (app, url);
        false
    }
}

/// App exit: stop the engine and empty its cache, waiting a few seconds at most.
pub fn shutdown(app: &AppHandle) {
    #[cfg(not(target_os = "ios"))]
    if engine::started(app).is_some() {
        tauri::async_runtime::block_on(async {
            let _ = tokio::time::timeout(std::time::Duration::from_secs(3), engine::stop(app)).await;
        });
    }
    #[cfg(target_os = "ios")]
    let _ = app;
}

#[cfg(all(test, not(target_os = "ios")))]
mod tests {
    use super::*;

    #[test]
    fn limits_from_settings() {
        let l =
            engine::limits(TorrentLimits { cache_gb: 2.5, download_mbps: 8.0, upload_mbps: 4.0, keep_sharing: true });
        assert_eq!(l.cache_bytes, 2_500_000_000);
        assert_eq!(l.download_bps.map(|r| r.get()), Some(1_000_000));
        assert_eq!(l.upload_bps.map(|r| r.get()), Some(500_000));
        assert!(l.keep_sharing);
        let none = engine::limits(TorrentLimits::default());
        assert_eq!((none.cache_bytes, none.download_bps, none.upload_bps, none.keep_sharing), (0, None, None, false));
    }
}
