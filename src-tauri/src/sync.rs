//! Local half of account sync. Knows nothing about the server: the frontend's
//! sync engine pulls/pushes through whichever account backend is configured
//! and uses these commands to read local changes and merge remote ones.
//!
//! Conflicts resolve last-write-wins per record on the client timestamps
//! (`added_at` / removal time for library items, `updated_at` for progress).

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::commands::{CmdError, Result};
use crate::store::{now, LibraryItem, Progress, Space, LOCAL_SPACE};
use crate::AppState;

/// A library record as it travels over sync: present or a removal.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncLibraryItem {
    pub id: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub name: String,
    pub poster: Option<String>,
    pub added_at: u64,
    pub deleted: bool,
    pub updated_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalChanges {
    pub library: Vec<SyncLibraryItem>,
    pub progress: Vec<Progress>,
    /// Pass back to `sync_mark_pushed` once these reached the server.
    pub cursor: u64,
    pub pulled_at: Option<String>,
}

fn save(state: &State<'_, AppState>, f: impl FnOnce(&mut crate::store::Data)) -> Result<()> {
    let mut store = state.store.lock().unwrap();
    f(&mut store.data);
    store.save().map_err(|e| CmdError::Other(format!("could not save: {e}")))
}

/// Switch which space library/progress commands use. `None` = signed out.
#[tauri::command]
pub fn space_activate(state: State<'_, AppState>, space: Option<String>) -> Result<()> {
    save(&state, |d| {
        d.active_space = space.unwrap_or_else(|| LOCAL_SPACE.into());
        d.space_mut();
    })
}

/// Copy the signed-out library and history into a profile (first sign-in).
#[tauri::command]
pub fn space_import_local(state: State<'_, AppState>, space: String) -> Result<()> {
    save(&state, |d| {
        let local = d.spaces.get(LOCAL_SPACE).cloned().unwrap_or_default();
        let target = d.spaces.entry(space).or_default();
        let library = local.library.values().map(present).collect();
        merge(target, library, local.progress.into_values().collect());
        // Everything imported still has to reach the server.
        target.pushed_at = 0;
    })
}

/// Forget cached profile data (sign-out, deleted profile). `None` = every
/// profile; the signed-out space is always kept.
#[tauri::command]
pub fn space_forget(state: State<'_, AppState>, space: Option<String>) -> Result<()> {
    save(&state, |d| {
        match space {
            Some(id) if id != LOCAL_SPACE => {
                d.spaces.remove(&id);
            }
            Some(_) => {}
            None => d.spaces.retain(|k, _| k == LOCAL_SPACE),
        }
        if !d.spaces.contains_key(&d.active_space) {
            d.active_space = LOCAL_SPACE.into();
        }
    })
}

/// Everything changed locally since the last push.
#[tauri::command]
pub fn sync_changes(state: State<'_, AppState>, space: String) -> LocalChanges {
    let store = state.store.lock().unwrap();
    let cursor = now();
    let Some(s) = store.data.spaces.get(&space) else {
        return LocalChanges { library: vec![], progress: vec![], cursor, pulled_at: None };
    };
    let since = s.pushed_at;
    let mut library: Vec<_> = s.library.values().filter(|i| i.added_at >= since).map(present).collect();
    library.extend(s.removed.iter().filter(|(_, at)| **at >= since).map(|(id, at)| SyncLibraryItem {
        id: id.clone(),
        ty: String::new(),
        name: String::new(),
        poster: None,
        added_at: *at,
        deleted: true,
        updated_at: *at,
    }));
    let progress = s.progress.values().filter(|p| p.updated_at >= since).cloned().collect();
    LocalChanges { library, progress, cursor, pulled_at: s.pulled_at.clone() }
}

#[tauri::command]
pub fn sync_mark_pushed(state: State<'_, AppState>, space: String, cursor: u64) -> Result<()> {
    save(&state, |d| {
        if let Some(s) = d.spaces.get_mut(&space) {
            s.pushed_at = s.pushed_at.max(cursor);
        }
    })
}

/// Merge changes pulled from the server. Returns whether anything changed.
#[tauri::command]
pub fn sync_apply(
    state: State<'_, AppState>,
    space: String,
    library: Vec<SyncLibraryItem>,
    progress: Vec<Progress>,
    pulled_at: Option<String>,
) -> Result<bool> {
    let mut changed = false;
    save(&state, |d| {
        // A pull that finishes after sign-out (or after the profile was
        // deleted) must not bring that profile's data back onto this device.
        let Some(s) = d.spaces.get_mut(&space) else { return };
        changed = merge(s, library, progress);
        if pulled_at.is_some() {
            s.pulled_at = pulled_at;
        }
    })?;
    Ok(changed)
}

fn present(i: &LibraryItem) -> SyncLibraryItem {
    SyncLibraryItem {
        id: i.id.clone(),
        ty: i.ty.clone(),
        name: i.name.clone(),
        poster: i.poster.clone(),
        added_at: i.added_at,
        deleted: false,
        updated_at: i.added_at,
    }
}

fn merge(s: &mut Space, library: Vec<SyncLibraryItem>, progress: Vec<Progress>) -> bool {
    let mut changed = false;
    for item in library {
        let local = s.library.get(&item.id).map(|i| i.added_at).max(s.removed.get(&item.id).copied()).unwrap_or(0);
        if item.updated_at <= local {
            continue;
        }
        changed = true;
        if item.deleted {
            s.library.remove(&item.id);
            s.removed.insert(item.id, item.updated_at);
        } else {
            s.removed.remove(&item.id);
            s.library.insert(
                item.id.clone(),
                LibraryItem { id: item.id, ty: item.ty, name: item.name, poster: item.poster, added_at: item.added_at },
            );
        }
    }
    for mut p in progress {
        let local = s.progress.get(&p.video_id);
        if local.is_some_and(|l| l.updated_at >= p.updated_at) {
            continue;
        }
        // The source isn't synced (its URL is large and often expires), so
        // keep this device's own for resuming.
        if p.stream.is_none() {
            p.stream = local.and_then(|l| l.stream.clone());
        }
        changed = true;
        s.progress.insert(p.video_id.clone(), p);
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, at: u64, deleted: bool) -> SyncLibraryItem {
        SyncLibraryItem {
            id: id.into(),
            ty: "movie".into(),
            name: id.into(),
            poster: None,
            added_at: at,
            deleted,
            updated_at: at,
        }
    }

    fn progress(video: &str, at: u64, pos: f64) -> Progress {
        Progress {
            meta_id: "tt1".into(),
            video_id: video.into(),
            ty: "movie".into(),
            name: "x".into(),
            background: None,
            poster: None,
            season: None,
            episode: None,
            episode_title: None,
            stream: None,
            position: pos,
            duration: 100.0,
            updated_at: at,
        }
    }

    #[test]
    fn newer_remote_add_and_remove_win() {
        let mut s = Space::default();
        assert!(merge(&mut s, vec![item("a", 10, false)], vec![]));
        assert!(s.library.contains_key("a"));
        assert!(merge(&mut s, vec![item("a", 20, true)], vec![]));
        assert!(!s.library.contains_key("a"));
        assert_eq!(s.removed.get("a"), Some(&20));
    }

    #[test]
    fn older_remote_never_overwrites_local() {
        let mut s = Space::default();
        merge(&mut s, vec![item("a", 30, false)], vec![progress("v", 50, 40.0)]);
        // A stale removal and stale progress from another device.
        assert!(!merge(&mut s, vec![item("a", 20, true)], vec![progress("v", 40, 5.0)]));
        assert!(s.library.contains_key("a"));
        assert_eq!(s.progress["v"].position, 40.0);
    }

    #[test]
    fn remote_progress_keeps_local_stream() {
        let mut s = Space::default();
        let mut local = progress("v", 10, 5.0);
        local.stream = Some(serde_json::from_str(r#"{"url":"https://x/a.mkv"}"#).unwrap());
        merge(&mut s, vec![], vec![local]);
        assert!(merge(&mut s, vec![], vec![progress("v", 20, 30.0)]));
        assert_eq!(s.progress["v"].position, 30.0);
        assert!(s.progress["v"].stream.is_some());
    }

    #[test]
    fn local_removal_beats_older_remote_add() {
        let mut s = Space::default();
        s.removed.insert("a".into(), 50);
        assert!(!merge(&mut s, vec![item("a", 40, false)], vec![]));
        assert!(!s.library.contains_key("a"));
    }

    #[test]
    fn legacy_file_moves_into_local_space() {
        let json = r#"{"library":{"tt1":{"id":"tt1","type":"movie","name":"A","poster":null,"addedAt":1}}}"#;
        let mut d: crate::store::Data = serde_json::from_str(json).unwrap();
        d.migrate();
        assert_eq!(d.active_space, LOCAL_SPACE);
        assert!(d.spaces[LOCAL_SPACE].library.contains_key("tt1"));
        // And the old fields aren't written back out.
        let out = serde_json::to_value(&d).unwrap();
        assert!(out.get("library").is_none() && out.get("progress").is_none());
    }
}
