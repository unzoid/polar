//! The local half of account sync: what changed since the last push, and
//! merging what was pulled. Knows nothing about the server.
//!
//! Conflicts resolve last-write-wins per record on the client timestamps:
//! a library item's last change or removal time, a progress row's
//! `updated_at`, an anime link's `updated_at`.

use serde::{Deserialize, Serialize};

use crate::identity::AnimeLink;
use crate::space::{Dirty, LibraryItem, Progress, Space};

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

/// What reached the server: each record's key and the time it carried, so a
/// record changed again meanwhile stays unpushed.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(default)]
pub struct Pushed {
    pub library: Vec<(String, u64)>,
    pub progress: Vec<(String, u64)>,
    pub links: Vec<(u32, u64)>,
}

impl Space {
    /// What changed here and hasn't reached the server yet.
    pub fn unpushed(&self) -> Changes {
        let Some(dirty) = &self.dirty else { return self.changes_since(self.pushed_at) };
        let library = dirty
            .library
            .iter()
            .filter_map(|id| match (self.library.get(id), self.removed.get(id)) {
                (Some(i), _) => Some(SyncLibraryItem::present(i)),
                (None, Some(&at)) => Some(SyncLibraryItem::removal(id, at)),
                (None, None) => None,
            })
            .collect();
        let progress = dirty.progress.iter().filter_map(|v| self.progress.get(v)).cloned().collect();
        let links = dirty.links.iter().filter_map(|a| self.links.get(a)).cloned().collect();
        Changes { library, progress, links }
    }

    /// The set of unpushed records, worked out from `pushed_at` the first time
    /// (stores written before it).
    pub(crate) fn dirty_mut(&mut self) -> &mut Dirty {
        if self.dirty.is_none() {
            let c = self.changes_since(self.pushed_at);
            self.dirty = Some(Dirty {
                library: c.library.into_iter().map(|i| i.id).collect(),
                progress: c.progress.into_iter().map(|p| p.video_id).collect(),
                links: c.links.into_iter().map(|l| l.anilist).collect(),
            });
        }
        self.dirty.get_or_insert_with(Dirty::default)
    }

    /// These reached the server: no longer unpushed, unless changed again since.
    pub fn mark_pushed(&mut self, pushed: &Pushed) {
        let library: Vec<_> = pushed
            .library
            .iter()
            .filter(|(id, at)| {
                let now = self.library.get(id).map(LibraryItem::changed_at).or_else(|| self.removed.get(id).copied());
                now.is_none_or(|now| now == *at)
            })
            .map(|(id, _)| id.clone())
            .collect();
        let progress: Vec<_> = pushed
            .progress
            .iter()
            .filter(|(v, at)| self.progress.get(v).is_none_or(|p| p.updated_at == *at))
            .map(|(v, _)| v.clone())
            .collect();
        let links: Vec<_> = pushed
            .links
            .iter()
            .filter(|(a, at)| self.links.get(a).is_none_or(|l| l.updated_at == *at))
            .map(|(a, _)| *a)
            .collect();
        let dirty = self.dirty_mut();
        dirty.library.retain(|id| !library.contains(id));
        dirty.progress.retain(|v| !progress.contains(v));
        dirty.links.retain(|a| !links.contains(a));
    }

    /// Everything here still has to reach the server (copied in at first sign-in).
    pub fn mark_all_unpushed(&mut self) {
        self.dirty = Some(Dirty {
            library: self.library.keys().chain(self.removed.keys()).cloned().collect(),
            progress: self.progress.keys().cloned().collect(),
            links: self.links.keys().copied().collect(),
        });
    }

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
        // Before anything pulled moves a time past `pushed_at` (stores from before `dirty`).
        self.dirty_mut();
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
                // The account keeps no names or pictures: keep what this device knows.
                let (name, poster) = if item.name.is_empty() {
                    self.display_of(&item.id).unwrap_or_default()
                } else {
                    (item.name, item.poster)
                };
                self.library.insert(
                    item.id.clone(),
                    LibraryItem { id: item.id, ty: item.ty, name, poster, added_at: item.added_at, updated_at },
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
            // Nor names or pictures: this video's own, else the title's from elsewhere on this device.
            if p.name.is_empty() {
                if let Some(l) = local {
                    p.name = l.name.clone();
                    p.poster = l.poster.clone();
                    p.background = l.background.clone();
                    p.episode_title = l.episode_title.clone();
                } else if let Some(other) =
                    self.progress.values().find(|o| o.meta_id == p.meta_id && !o.name.is_empty())
                {
                    p.name = other.name.clone();
                    p.poster = other.poster.clone();
                    p.background = other.background.clone();
                } else if let Some((name, poster)) = self.display_of(&p.meta_id) {
                    p.name = name;
                    p.poster = poster;
                }
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

impl Space {
    /// The name and poster this device has for a title, from its library or progress.
    fn display_of(&self, meta_id: &str) -> Option<(String, Option<String>)> {
        if let Some(i) = self.library.get(meta_id).filter(|i| !i.name.is_empty()) {
            return Some((i.name.clone(), i.poster.clone()));
        }
        self.progress
            .values()
            .find(|p| p.meta_id == meta_id && !p.name.is_empty())
            .map(|p| (p.name.clone(), p.poster.clone()))
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
    fn pulled_rows_without_names_keep_this_devices() {
        let mut s = Space::default();
        let mut mine = item("tt1", 10);
        mine.name = "One".into();
        mine.poster = Some("https://example.com/p.jpg".into());
        let mut watched = progress("tt1", "tt1:1:1", 10, 5.0);
        watched.name = "One".into();
        watched.background = Some("https://example.com/b.jpg".into());
        watched.episode_title = Some("Pilot".into());
        pull(&mut s, vec![SyncLibraryItem::present(&mine)], vec![watched]);

        let mut bare = sync_item("tt1", 20, false);
        bare.name = String::new();
        bare.poster = None;
        let mut same = progress("tt1", "tt1:1:1", 20, 9.0);
        same.name = String::new();
        let mut next = progress("tt1", "tt1:1:2", 21, 1.0);
        next.name = String::new();
        let mut unknown = progress("tt2", "tt2", 21, 1.0);
        unknown.name = String::new();
        assert!(pull(&mut s, vec![bare], vec![same, next, unknown]));

        assert_eq!(s.library["tt1"].name, "One");
        assert_eq!(s.library["tt1"].poster.as_deref(), Some("https://example.com/p.jpg"));
        assert_eq!(s.progress["tt1:1:1"].episode_title.as_deref(), Some("Pilot"));
        assert_eq!(s.progress["tt1:1:1"].position, 9.0);
        assert_eq!(s.progress["tt1:1:2"].name, "One");
        assert_eq!(s.progress["tt1:1:2"].background.as_deref(), Some("https://example.com/b.jpg"));
        assert_eq!(s.progress["tt1:1:2"].episode_title, None);
        assert_eq!(s.progress["tt2"].name, "");
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
        let c = s.unpushed();
        assert_eq!(c.links.len(), 1);
        let mut lib: Vec<_> = c.library.iter().map(|i| (i.id.as_str(), i.deleted, i.updated_at)).collect();
        lib.sort();
        assert_eq!(lib, [("kitsu:5", true, 70), ("tt9", false, 70)]);
    }

    fn pushed(c: &Changes) -> Pushed {
        Pushed {
            library: c.library.iter().map(|i| (i.id.clone(), i.updated_at)).collect(),
            progress: c.progress.iter().map(|p| (p.video_id.clone(), p.updated_at)).collect(),
            links: c.links.iter().map(|l| (l.anilist, l.updated_at)).collect(),
        }
    }

    #[test]
    fn pulled_rows_are_not_sent_back() {
        let mut s = Space { dirty: Some(Dirty::default()), ..Space::default() };
        pull(&mut s, vec![sync_item("a", 10, false)], vec![progress("tt1", "tt1", 20, 100.0)]);
        let c = s.unpushed();
        assert!(c.library.is_empty() && c.progress.is_empty());
    }

    #[test]
    fn an_edit_made_during_a_push_stays_unpushed() {
        let mut s = Space::default();
        s.library_toggle(item("a", 0), 10);
        s.progress_save(vec![progress("tt1", "tt1", 0, 100.0)], 10);
        let sent = s.unpushed();
        assert_eq!((sent.library.len(), sent.progress.len()), (1, 1));
        // Watched further while the push was on its way.
        s.progress_save(vec![progress("tt1", "tt1", 0, 200.0)], 11);
        s.mark_pushed(&pushed(&sent));
        let left = s.unpushed();
        assert!(left.library.is_empty());
        assert_eq!(left.progress.len(), 1);
        assert_eq!(left.progress[0].position, 200.0);
    }

    #[test]
    fn a_clock_that_steps_back_cannot_hide_an_edit() {
        let mut s = Space::default();
        s.progress_save(vec![progress("tt1", "tt1", 0, 100.0)], 1_000);
        s.mark_pushed(&pushed(&s.unpushed()));
        s.progress_save(vec![progress("tt2", "tt2", 0, 100.0)], 500);
        assert_eq!(s.unpushed().progress.len(), 1);
    }

    #[test]
    fn a_store_from_before_dirty_starts_from_its_push_time() {
        let mut s = Space::default();
        s.library.insert("old".into(), item("old", 10));
        s.library.insert("new".into(), item("new", 60));
        s.pushed_at = 50;
        assert_eq!(s.unpushed().library.len(), 1);
        // A pull newer than the push time isn't taken for a local edit.
        pull(&mut s, vec![sync_item("pulled", 70, false)], vec![]);
        let ids: Vec<_> = s.unpushed().library.into_iter().map(|i| i.id).collect();
        assert_eq!(ids, ["new"]);
    }

    #[test]
    fn removals_and_imports_are_unpushed() {
        let mut s = Space::default();
        s.library_toggle(item("a", 0), 10);
        s.mark_pushed(&pushed(&s.unpushed()));
        s.library_toggle(item("a", 0), 20);
        let c = s.unpushed();
        assert!(c.library[0].deleted && c.library[0].updated_at == 20);
        s.library_toggle(item("b", 0), 30);
        let mut profile = Space::default();
        profile.import(&s);
        profile.mark_all_unpushed();
        assert_eq!(profile.unpushed().library.len(), 1);
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
