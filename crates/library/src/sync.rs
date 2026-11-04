//! The local half of account sync: what changed since the last push, and
//! merging what was pulled. Knows nothing about the server.
//!
//! Conflicts resolve last-write-wins per record on the client timestamps:
//! a library item's last change or removal time, a progress row's
//! `updated_at`, an anime link's `updated_at`.

use serde::{Deserialize, Serialize};

use crate::identity::AnimeLink;
use crate::space::{LibraryItem, Progress, Space};

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

impl SyncLibraryItem {
    pub fn present(i: &LibraryItem) -> Self {
        Self {
            id: i.id.clone(),
            ty: i.ty.clone(),
            name: i.name.clone(),
            poster: i.poster.clone(),
            added_at: i.added_at,
            deleted: false,
            updated_at: i.changed_at(),
        }
    }

    pub fn removal(id: &str, at: u64) -> Self {
        Self {
            id: id.to_owned(),
            ty: String::new(),
            name: String::new(),
            poster: None,
            added_at: at,
            deleted: true,
            updated_at: at,
        }
    }
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Changes {
    pub library: Vec<SyncLibraryItem>,
    pub progress: Vec<Progress>,
    pub links: Vec<AnimeLink>,
}

impl Space {
    /// Everything changed locally at or after `since` (ms).
    pub fn changes_since(&self, since: u64) -> Changes {
        let mut library: Vec<_> =
            self.library.values().filter(|i| i.changed_at() >= since).map(SyncLibraryItem::present).collect();
        library.extend(
            self.removed.iter().filter(|(_, &at)| at >= since).map(|(id, &at)| SyncLibraryItem::removal(id, at)),
        );
        let progress = self.progress.values().filter(|p| p.updated_at >= since).cloned().collect();
        let links = self.links.values().filter(|l| l.updated_at >= since).cloned().collect();
        Changes { library, progress, links }
    }

    /// Copies another space's library, history and links in (first sign-in
    /// on a device that was used signed out).
    pub fn import(&mut self, other: &Space) -> bool {
        let library = other.library.values().map(SyncLibraryItem::present).collect();
        let progress = other.progress.values().cloned().collect();
        let links = other.links.values().cloned().collect();
        self.merge(Changes { library, progress, links })
    }

    /// Merges changes pulled from the server. Links go first, so rows
    /// arriving under an alias land on their canonical id. Returns whether
    /// anything changed.
    pub fn merge(&mut self, changes: Changes) -> bool {
        let mut changed = false;
        let mut new_links = false;
        for link in changes.links {
            if !link.is_valid() {
                continue;
            }
            if self.links.get(&link.anilist).is_some_and(|l| l.updated_at >= link.updated_at) {
                continue;
            }
            self.links.insert(link.anilist, link);
            new_links = true;
        }
        for item in changes.library {
            let local =
                self.library.get(&item.id).map(LibraryItem::changed_at).max(self.removed.get(&item.id).copied());
            if local.is_some_and(|l| item.updated_at <= l) {
                continue;
            }
            changed = true;
            if item.deleted {
                self.library.remove(&item.id);
                self.removed.insert(item.id, item.updated_at);
            } else {
                self.removed.remove(&item.id);
                let updated_at = if item.updated_at > item.added_at { item.updated_at } else { 0 };
                self.library.insert(
                    item.id.clone(),
                    LibraryItem {
                        id: item.id,
                        ty: item.ty,
                        name: item.name,
                        poster: item.poster,
                        added_at: item.added_at,
                        updated_at,
                    },
                );
            }
        }
        for mut p in changes.progress {
            let local = self.progress.get(&p.video_id);
            if local.is_some_and(|l| l.updated_at >= p.updated_at) {
                continue;
            }
            // The source isn't synced (its URL is large and often expires),
            // so keep this device's own for resuming.
            if p.stream.is_none() {
                p.stream = local.and_then(|l| l.stream.clone());
            }
            changed = true;
            self.progress.insert(p.video_id.clone(), p);
        }
        if changed || new_links {
            self.rekey();
        }
        changed || new_links
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::space::tests::{item, link, progress};

    fn sync_item(id: &str, at: u64, deleted: bool) -> SyncLibraryItem {
        let mut i = SyncLibraryItem::present(&item(id, at));
        i.deleted = deleted;
        i
    }

    fn pull(s: &mut Space, library: Vec<SyncLibraryItem>, progress: Vec<Progress>) -> bool {
        s.merge(Changes { library, progress, links: vec![] })
    }

    #[test]
    fn newer_remote_add_and_remove_win() {
        let mut s = Space::default();
        assert!(pull(&mut s, vec![sync_item("a", 10, false)], vec![]));
        assert!(s.library.contains_key("a"));
        assert!(pull(&mut s, vec![sync_item("a", 20, true)], vec![]));
        assert!(!s.library.contains_key("a"));
        assert_eq!(s.removed.get("a"), Some(&20));
    }

    #[test]
    fn older_remote_never_overwrites_local() {
        let mut s = Space::default();
        pull(&mut s, vec![sync_item("a", 30, false)], vec![progress("tt1", "v", 50, 40.0)]);
        // A stale removal and stale progress from another device.
        assert!(!pull(&mut s, vec![sync_item("a", 20, true)], vec![progress("tt1", "v", 40, 5.0)]));
        assert!(s.library.contains_key("a"));
        assert_eq!(s.progress["v"].position, 40.0);
    }

    #[test]
    fn remote_progress_keeps_local_stream() {
        let mut s = Space::default();
        let mut local = progress("tt1", "v", 10, 5.0);
        local.stream = Some(serde_json::from_str(r#"{"url":"https://example.com/a.mkv"}"#).unwrap());
        pull(&mut s, vec![], vec![local]);
        assert!(pull(&mut s, vec![], vec![progress("tt1", "v", 20, 30.0)]));
        assert_eq!(s.progress["v"].position, 30.0);
        assert!(s.progress["v"].stream.is_some());
    }

    #[test]
    fn local_removal_beats_older_remote_add() {
        let mut s = Space::default();
        s.removed.insert("a".into(), 50);
        assert!(!pull(&mut s, vec![sync_item("a", 40, false)], vec![]));
        assert!(!s.library.contains_key("a"));
    }

    #[test]
    fn changes_include_moved_items_links_and_removals() {
        let mut s = Space::default();
        s.library.insert("kitsu:5".into(), item("kitsu:5", 10));
        s.pushed_at = 50;
        s.link_anime(link(1, "tt9", Some(5), 70));
        let c = s.changes_since(s.pushed_at);
        assert_eq!(c.links.len(), 1);
        let mut lib: Vec<_> = c.library.iter().map(|i| (i.id.as_str(), i.deleted, i.updated_at)).collect();
        lib.sort();
        assert_eq!(lib, [("kitsu:5", true, 70), ("tt9", false, 70)]);
    }

    #[test]
    fn pulled_rows_under_an_alias_land_on_the_canonical_id() {
        let mut s = Space::default();
        s.link_anime(link(1, "tt9", Some(5), 1));
        pull(&mut s, vec![sync_item("kitsu:5", 10, false)], vec![progress("kitsu:5", "kitsu:5:2", 10, 100.0)]);
        assert!(s.library.contains_key("tt9") && !s.library.contains_key("kitsu:5"));
        assert_eq!(s.progress["kitsu:5:2"].meta_id, "tt9");
    }

    #[test]
    fn a_pulled_link_rekeys_and_two_devices_agree() {
        // Device A links the entry and pushes; device B still has the old ids.
        let mut a = Space::default();
        a.library.insert("kitsu:5".into(), item("kitsu:5", 10));
        a.progress.insert("kitsu:5:1".into(), progress("kitsu:5", "kitsu:5:1", 10, 100.0));
        let mut b = a.clone();
        a.link_anime(link(1, "tt9", Some(5), 30));
        assert!(b.merge(a.changes_since(20)));
        let ids = |s: &Space| {
            let mut v: Vec<_> = s.library.keys().cloned().collect();
            v.sort();
            v
        };
        assert_eq!(ids(&a), ids(&b));
        assert_eq!(b.progress["kitsu:5:1"].meta_id, "tt9");
        assert_eq!(a.library, b.library);
        assert_eq!(a.removed, b.removed);
        // So B pushing what it re-keyed changes nothing on A.
        assert!(!a.merge(b.changes_since(20)));
    }

    #[test]
    fn import_brings_links_along() {
        let mut local = Space::default();
        local.library.insert("tt9".into(), item("tt9", 10));
        local.link_anime(link(1, "tt9", Some(5), 1));
        let mut profile = Space::default();
        profile.library.insert("kitsu:5".into(), item("kitsu:5", 5));
        assert!(profile.import(&local));
        assert_eq!(profile.library.len(), 1);
        assert_eq!(profile.library["tt9"].added_at, 5);
    }
}
