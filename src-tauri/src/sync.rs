//! Local half of account sync, as commands. Knows nothing about the server:
//! the frontend's sync engine pulls/pushes through whichever account backend
//! is configured and uses these commands to read local changes and merge
//! remote ones. The merge rules live in `polar_library::sync`.

use polar_library::{AnimeLink, Changes, Display, Progress, SyncLibraryItem, Untitled};
use serde::Serialize;
use tauri::State;

use crate::commands::Result;
use crate::locks::Locked;
use crate::store::{now, LOCAL_SPACE};
use crate::AppState;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalChanges {
    #[serde(flatten)]
    pub changes: Changes,
    /// Pass back to `sync_mark_pushed` once these reached the server.
    pub cursor: u64,
    pub pulled_at: Option<String>,
}

/// Switch which space library/progress commands use. `None` = signed out.
#[tauri::command]
pub fn space_activate(state: State<'_, AppState>, space: Option<String>) -> Result<()> {
    state.persist(|d| {
        d.active_space = space.unwrap_or_else(|| LOCAL_SPACE.into());
        d.space_mut();
    })
}

/// Copy the signed-out library, history and anime links into a profile
/// (first sign-in).
#[tauri::command]
pub fn space_import_local(state: State<'_, AppState>, space: String) -> Result<()> {
    state.persist(|d| {
        let local = d.spaces.get(LOCAL_SPACE).cloned().unwrap_or_default();
        let target = d.spaces.entry(space).or_default();
        target.import(&local);
        // Everything imported still has to reach the server.
        target.pushed_at = 0;
    })
}

/// Forget cached profile data (sign-out, deleted profile). `None` = every
/// profile; the signed-out space is always kept.
#[tauri::command]
pub fn space_forget(state: State<'_, AppState>, space: Option<String>) -> Result<()> {
    state.persist(|d| {
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
    let store = state.store.locked();
    let cursor = now();
    match store.data.spaces.get(&space) {
        Some(s) => LocalChanges { changes: s.changes_since(s.pushed_at), cursor, pulled_at: s.pulled_at.clone() },
        None => LocalChanges { changes: Changes::default(), cursor, pulled_at: None },
    }
}

#[tauri::command]
pub fn sync_mark_pushed(state: State<'_, AppState>, space: String, cursor: u64) -> Result<()> {
    state.persist(|d| {
        if let Some(s) = d.spaces.get_mut(&space) {
            s.pushed_at = s.pushed_at.max(cursor);
        }
    })
}

/// Merge changes pulled from the server. Returns whether anything changed.
/// `links` is optional until the account backends carry anime links.
#[tauri::command]
pub fn sync_apply(
    state: State<'_, AppState>,
    space: String,
    library: Vec<SyncLibraryItem>,
    progress: Vec<Progress>,
    links: Option<Vec<AnimeLink>>,
    pulled_at: Option<String>,
) -> Result<bool> {
    let mut changed = false;
    state.persist(|d| {
        // A pull that finishes after sign-out (or after the profile was
        // deleted) must not bring that profile's data back onto this device.
        let Some(s) = d.spaces.get_mut(&space) else { return };
        changed = s.merge(Changes { library, progress, links: links.unwrap_or_default() });
        if pulled_at.is_some() {
            s.pulled_at = pulled_at;
        }
    })?;
    Ok(changed)
}

/// Titles pulled without a name (the account keeps none), most recent first.
#[tauri::command]
pub fn space_untitled(state: State<'_, AppState>, space: String) -> Vec<Untitled> {
    state.store.locked().data.spaces.get(&space).map(|s| s.untitled()).unwrap_or_default()
}

/// Names and pictures found for pulled titles; fills only what is missing
/// and moves no times, so nothing is pushed back.
#[tauri::command]
pub fn space_fill_display(state: State<'_, AppState>, space: String, found: Vec<Display>) -> Result<bool> {
    let mut changed = false;
    state.persist(|d| {
        if let Some(s) = d.spaces.get_mut(&space) {
            changed = s.fill_display(found);
        }
    })?;
    Ok(changed)
}

#[cfg(test)]
mod tests {
    use crate::store::LOCAL_SPACE;

    // The merge rules are tested in polar_library::sync.

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
