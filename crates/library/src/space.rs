//! One person's library, watch progress and anime links, and the operations
//! on them. Every title is kept under its canonical id (see `identity`):
//! writes canonicalise the id they are given, and recording an anime link
//! moves what was kept under its other ids onto the canonical one.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use serde::{Deserialize, Serialize};

use crate::identity::{Aliases, AnimeLink};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryItem {
    pub id: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub name: String,
    pub poster: Option<String>,
    pub added_at: u64,
    /// Last change (ms) when it differs from `added_at`, e.g. the item was
    /// moved onto its canonical id. 0 = never changed since added.
    #[serde(default, skip_serializing_if = "is_zero")]
    pub updated_at: u64,
}

fn is_zero(n: &u64) -> bool {
    *n == 0
}

impl LibraryItem {
    /// When the item last changed: what sync compares.
    pub fn changed_at(&self) -> u64 {
        self.added_at.max(self.updated_at)
    }
}

/// Progress for one playable video (a movie id, `tt…:s:e` or `kitsu:N:e`).
/// The video id stays what it was played under; `meta_id` is the title's
/// canonical id.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub meta_id: String,
    pub video_id: String,
    #[serde(rename = "type")]
    pub ty: String,
    pub name: String,
    pub background: Option<String>,
    pub poster: Option<String>,
    pub season: Option<u32>,
    pub episode: Option<u32>,
    pub episode_title: Option<String>,
    /// The source that was playing, so resume uses the same file (and timings).
    #[serde(default)]
    pub stream: Option<polar_addon::Stream>,
    /// Seconds.
    pub position: f64,
    pub duration: f64,
    pub updated_at: u64,
}

impl Progress {
    pub fn fraction(&self) -> f64 {
        if self.duration > 0.0 {
            (self.position / self.duration).clamp(0.0, 1.0)
        } else {
            0.0
        }
    }

    /// Past the watched threshold (Settings → Playback), e.g. 0.92.
    pub fn finished(&self, threshold: f64) -> bool {
        self.fraction() >= threshold
    }

    /// Far enough in to count as started (resumable, in history).
    pub fn started(&self) -> bool {
        self.position > 30.0
    }
}

/// How many titles Continue Watching shows.
pub const CONTINUE_LIMIT: usize = 20;
/// How many titles the Library's "Watched" shelf shows.
pub const HISTORY_LIMIT: usize = 200;

/// Records changed on this device and not yet on the server, by key. Pulled
/// changes never land here, so they aren't sent back; a clock that steps
/// back can't hide an edit either.
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct Dirty {
    /// Library ids, in the library or removed.
    pub library: BTreeSet<String>,
    /// Progress video ids.
    pub progress: BTreeSet<String>,
    /// AniList ids.
    pub links: BTreeSet<u32>,
}

/// One person's library and watch history: the signed-out "local" space, or
/// one per account profile. Each is a full offline copy; sync only moves
/// changes between it and the server.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Space {
    pub library: HashMap<String, LibraryItem>,
    /// Removed library items → when (ms), so removals sync too.
    pub removed: HashMap<String, u64>,
    pub progress: HashMap<String, Progress>,
    /// AniList id → what Polarity knows about that entry.
    pub links: BTreeMap<u32, AnimeLink>,
    /// Stores written before `dirty`: the local clock (ms) of the last push.
    /// Read once, to work out what was still unpushed.
    pub pushed_at: u64,
    /// What changed here and hasn't reached the server (critique H2). `None`
    /// in stores written before it: then what changed since `pushed_at`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dirty: Option<Dirty>,
    /// Server cursor of the last pull (opaque to Rust).
    pub pulled_at: Option<String>,
}

impl Space {
    pub fn aliases(&self) -> Aliases {
        Aliases::from_links(self.links.values())
    }

    /// Library items, newest first.
    pub fn library_list(&self) -> Vec<LibraryItem> {
        let mut items: Vec<_> = self.library.values().cloned().collect();
        items.sort_by(|a, b| b.added_at.cmp(&a.added_at).then_with(|| a.id.cmp(&b.id)));
        items
    }

    /// Adds the item, or removes it if it is there. Returns whether it is in
    /// the library afterwards.
    pub fn library_toggle(&mut self, mut item: LibraryItem, at: u64) -> bool {
        item.id = self.aliases().canonical(&item.id).to_owned();
        self.dirty_mut().library.insert(item.id.clone());
        if self.library.remove(&item.id).is_some() {
            self.removed.insert(item.id, at);
            false
        } else {
            self.removed.remove(&item.id);
            item.added_at = at;
            item.updated_at = 0;
            self.library.insert(item.id.clone(), item);
            true
        }
    }

    /// Every progress entry for one title (all episodes of a series), under
    /// whichever of its ids it is asked for.
    pub fn progress_for(&self, meta_id: &str) -> Vec<Progress> {
        let aliases = self.aliases();
        let id = aliases.canonical(meta_id);
        self.progress.values().filter(|p| aliases.canonical(&p.meta_id) == id).cloned().collect()
    }

    /// Saves entries in order, the last one counting as the title's latest.
    pub fn progress_save(&mut self, entries: Vec<Progress>, at: u64) {
        let aliases = self.aliases();
        for (i, mut p) in entries.into_iter().enumerate() {
            p.meta_id = aliases.canonical(&p.meta_id).to_owned();
            p.updated_at = at + i as u64;
            self.dirty_mut().progress.insert(p.video_id.clone());
            self.progress.insert(p.video_id.clone(), p);
        }
    }

    /// The latest video per title, among those `keep` accepts, newest first.
    fn latest_per_title(&self, keep: impl Fn(&Progress) -> bool) -> Vec<Progress> {
        let aliases = self.aliases();
        let mut latest: HashMap<&str, &Progress> = HashMap::new();
        for p in self.progress.values().filter(|p| keep(p)) {
            let slot = latest.entry(aliases.canonical(&p.meta_id)).or_insert(p);
            if (p.updated_at, &p.video_id) > (slot.updated_at, &slot.video_id) {
                *slot = p;
            }
        }
        let mut items: Vec<Progress> = latest.into_values().cloned().collect();
        items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then_with(|| a.video_id.cmp(&b.video_id)));
        items
    }

    /// Latest unfinished video per title, newest first. Only videos watched past the start
    /// count: opening another episode for a few seconds doesn't take the show out (test
    /// report 1, item 4); its latest started video still decides, finished or not.
    pub fn continue_watching(&self, watched: f64) -> Vec<Progress> {
        let mut items = self.latest_per_title(Progress::started);
        items.retain(|p| !p.finished(watched) && p.started());
        items.truncate(CONTINUE_LIMIT);
        items
    }

    /// Everything watched: the latest video per title, finished or well under
    /// way, newest first.
    pub fn watch_history(&self, watched: f64) -> Vec<Progress> {
        let mut items = self.latest_per_title(|p| p.finished(watched) || p.started());
        items.truncate(HISTORY_LIMIT);
        items
    }

    /// Records a link and moves what was kept under its other ids onto the
    /// canonical one. An older decision about the same AniList entry than the
    /// one already kept is ignored. Returns whether anything changed.
    pub fn link_anime(&mut self, link: AnimeLink) -> bool {
        if !link.is_valid() {
            return false;
        }
        match self.links.get(&link.anilist) {
            Some(old) if old.updated_at > link.updated_at || *old == link => return false,
            _ => {}
        }
        self.dirty_mut().links.insert(link.anilist);
        self.links.insert(link.anilist, link);
        self.rekey();
        true
    }

    /// Moves every library item and progress row kept under an alias onto
    /// its canonical id. The same links give the same result on every device.
    ///
    /// A library item moved this way is stamped with the newest link's time
    /// (or its own, if later), so it reaches the server under its new id,
    /// and its old id is marked removed at that time so the old row is
    /// deleted there. The stamp depends only on the data, so a device that
    /// re-keys after pulling reaches exactly what the linking device pushed. When the canonical id already has an item, they
    /// become one, added at the earlier time. An item removed under its
    /// canonical id after it was last changed stays removed. Progress keeps
    /// its video id and time; only its `meta_id` changes.
    pub fn rekey(&mut self) -> bool {
        let aliases = self.aliases();
        if aliases.is_empty() {
            return false;
        }
        let links_at = self.links.values().map(|l| l.updated_at).max().unwrap_or(0);
        let mut changed = false;
        self.dirty_mut();

        let mut moving: Vec<String> =
            self.library.keys().filter(|k| aliases.canonical(k) != k.as_str()).cloned().collect();
        moving.sort();
        for old_id in moving {
            let Some(mut item) = self.library.remove(&old_id) else { continue };
            changed = true;
            self.dirty_mut().library.extend([old_id.clone(), aliases.canonical(&old_id).to_owned()]);
            let at = links_at.max(item.changed_at());
            let gone = self.removed.entry(old_id).or_default();
            *gone = (*gone).max(at);
            let id = aliases.canonical(&item.id).to_owned();
            if self.removed.get(&id).is_some_and(|&gone| gone >= item.changed_at()) {
                continue;
            }
            item.id = id.clone();
            item.updated_at = at;
            if let Some(kept) = self.library.get(&id) {
                item.added_at = item.added_at.min(kept.added_at);
                if kept.changed_at() >= item.changed_at() {
                    item.name = kept.name.clone();
                    item.poster = kept.poster.clone().or(item.poster);
                    item.ty = kept.ty.clone();
                }
            }
            self.removed.remove(&id);
            self.library.insert(id, item);
        }

        let mut moved = Vec::new();
        for p in self.progress.values_mut() {
            let id = aliases.canonical(&p.meta_id);
            if id != p.meta_id {
                p.meta_id = id.to_owned();
                moved.push(p.video_id.clone());
                changed = true;
            }
        }
        // The server keeps progress per title, so it goes up under its new one.
        self.dirty_mut().progress.extend(moved);
        changed
    }

    /// Adds what another app exported, keeping its times: a library item only if it isn't here
    /// and wasn't removed here after it was added there, a progress entry only over an older one
    /// (or none). Importing the same records again changes nothing. Entries without a time get
    /// `at`. Returns how many library items and progress entries were added.
    pub fn import_exported(&mut self, library: Vec<LibraryItem>, progress: Vec<Progress>, at: u64) -> (usize, usize) {
        let aliases = self.aliases();
        let mut added = (0, 0);
        for mut item in library {
            item.id = aliases.canonical(&item.id).to_owned();
            if item.added_at == 0 {
                item.added_at = at;
            }
            item.updated_at = 0;
            if self.library.contains_key(&item.id)
                || self.removed.get(&item.id).is_some_and(|&gone| gone >= item.added_at)
            {
                continue;
            }
            self.dirty_mut().library.insert(item.id.clone());
            self.removed.remove(&item.id);
            self.library.insert(item.id.clone(), item);
            added.0 += 1;
        }
        for mut p in progress {
            p.meta_id = aliases.canonical(&p.meta_id).to_owned();
            if p.updated_at == 0 {
                p.updated_at = at;
            }
            if self.progress.get(&p.video_id).is_some_and(|kept| kept.updated_at >= p.updated_at) {
                continue;
            }
            self.dirty_mut().progress.insert(p.video_id.clone());
            self.progress.insert(p.video_id.clone(), p);
            added.1 += 1;
        }
        added
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub fn item(id: &str, at: u64) -> LibraryItem {
        LibraryItem { id: id.into(), ty: "series".into(), name: id.into(), poster: None, added_at: at, updated_at: 0 }
    }

    pub fn progress(meta: &str, video: &str, at: u64, pos: f64) -> Progress {
        Progress {
            meta_id: meta.into(),
            video_id: video.into(),
            ty: "series".into(),
            name: "x".into(),
            background: None,
            poster: None,
            season: None,
            episode: None,
            episode_title: None,
            stream: None,
            position: pos,
            duration: 1000.0,
            updated_at: at,
        }
    }

    pub fn link(anilist: u32, canonical: &str, kitsu: Option<u32>, at: u64) -> AnimeLink {
        AnimeLink { canonical: canonical.into(), anilist, mal: None, kitsu, updated_at: at }
    }

    #[test]
    fn import_keeps_times_never_overwrites_newer_and_is_idempotent() {
        let mut s = Space::default();
        s.library_toggle(item("tt1", 0), 50);
        s.library_toggle(item("tt2", 0), 60);
        s.library_toggle(item("tt2", 0), 70);
        s.progress_save(vec![progress("tt3", "tt3:1:1", 0, 10.0)], 500);
        let library = vec![item("tt1", 5), item("tt2", 40), item("tt2b", 80), item("tt4", 0)];
        let rows = vec![progress("tt3", "tt3:1:1", 400, 900.0), progress("tt3", "tt3:1:2", 450, 1000.0)];

        assert_eq!(s.import_exported(library.clone(), rows.clone(), 1000), (2, 1));
        assert_eq!(s.library["tt1"].added_at, 50, "already in the library: left alone");
        assert!(!s.library.contains_key("tt2"), "removed here after it was added there");
        assert_eq!(s.library["tt2b"].added_at, 80);
        assert_eq!(s.library["tt4"].added_at, 1000, "no time: the import's");
        assert_eq!(s.progress["tt3:1:1"].position, 10.0, "newer here: kept");
        assert_eq!(s.progress["tt3:1:2"].updated_at, 450);
        assert!(s.dirty.as_ref().unwrap().progress.contains("tt3:1:2"));
        assert!(s.dirty.as_ref().unwrap().library.contains("tt2b"));

        let before = (s.library.clone(), s.progress.len());
        assert_eq!(s.import_exported(library, rows, 2000), (0, 0));
        assert_eq!((s.library.clone(), s.progress.len()), before);
    }

    #[test]
    fn toggle_adds_then_removes_and_records_the_removal() {
        let mut s = Space::default();
        assert!(s.library_toggle(item("tt1", 0), 10));
        assert_eq!(s.library["tt1"].added_at, 10);
        assert!(!s.library_toggle(item("tt1", 0), 20));
        assert_eq!(s.removed["tt1"], 20);
        assert!(s.library_toggle(item("tt1", 0), 30));
        assert!(!s.removed.contains_key("tt1"));
    }

    #[test]
    fn writes_use_the_canonical_id() {
        let mut s = Space::default();
        s.link_anime(link(1, "tt9", Some(5), 1));
        assert!(s.library_toggle(item("kitsu:5", 0), 10));
        assert!(s.library.contains_key("tt9"));
        s.progress_save(vec![progress("anilist:1", "kitsu:5:3", 0, 100.0)], 20);
        let p = &s.progress["kitsu:5:3"];
        assert_eq!((p.meta_id.as_str(), p.updated_at), ("tt9", 20));
        assert_eq!(s.progress_for("kitsu:5").len(), 1);
        assert_eq!(s.progress_for("anilist:1").len(), 1);
    }

    #[test]
    fn save_many_orders_entries() {
        let mut s = Space::default();
        s.progress_save(vec![progress("tt1", "tt1:1:1", 0, 0.0), progress("tt1", "tt1:1:2", 0, 0.0)], 100);
        assert_eq!(s.progress["tt1:1:1"].updated_at, 100);
        assert_eq!(s.progress["tt1:1:2"].updated_at, 101);
    }

    #[test]
    fn linking_merges_library_items_into_one() {
        let mut s = Space::default();
        s.library.insert("kitsu:5".into(), item("kitsu:5", 10));
        s.library.insert("tt9".into(), item("tt9", 20));
        assert!(s.link_anime(link(1, "tt9", Some(5), 40)));
        assert_eq!(s.library.len(), 1);
        let it = &s.library["tt9"];
        assert_eq!((it.added_at, it.updated_at), (10, 40));
        assert_eq!(s.removed["kitsu:5"], 40);
    }

    #[test]
    fn linking_moves_progress_without_touching_video_ids_or_times() {
        let mut s = Space::default();
        s.progress.insert("kitsu:5:1".into(), progress("kitsu:5", "kitsu:5:1", 10, 500.0));
        s.progress.insert("tt9:1:2".into(), progress("tt9", "tt9:1:2", 20, 100.0));
        s.link_anime(link(1, "tt9", Some(5), 40));
        assert_eq!(s.progress["kitsu:5:1"].meta_id, "tt9");
        assert_eq!(s.progress["kitsu:5:1"].updated_at, 10);
        // One title in Continue Watching, its latest episode.
        let cw = s.continue_watching(0.92);
        assert_eq!(cw.len(), 1);
        assert_eq!(cw[0].video_id, "tt9:1:2");
    }

    #[test]
    fn a_brief_look_at_another_episode_keeps_the_show_in_continue_watching() {
        // Test report 1, item 4: halfway through S1E2, then S2E1 and S2E2 opened for a few seconds.
        let mut s = Space::default();
        s.progress.insert("tt9:1:1".into(), progress("tt9", "tt9:1:1", 10, 990.0));
        s.progress.insert("tt9:1:2".into(), progress("tt9", "tt9:1:2", 20, 400.0));
        s.progress.insert("tt9:2:1".into(), progress("tt9", "tt9:2:1", 30, 12.0));
        s.progress.insert("tt9:2:2".into(), progress("tt9", "tt9:2:2", 40, 1.0));
        let cw: Vec<_> = s.continue_watching(0.92).into_iter().map(|p| p.video_id).collect();
        assert_eq!(cw, ["tt9:1:2"]);
        // Watching on past 30 s makes that episode the one to resume.
        s.progress.insert("tt9:2:2".into(), progress("tt9", "tt9:2:2", 50, 31.0));
        let cw: Vec<_> = s.continue_watching(0.92).into_iter().map(|p| p.video_id).collect();
        assert_eq!(cw, ["tt9:2:2"]);
    }

    #[test]
    fn a_title_removed_under_its_canonical_id_stays_removed() {
        let mut s = Space::default();
        s.library.insert("kitsu:5".into(), item("kitsu:5", 10));
        s.removed.insert("tt9".into(), 20);
        s.link_anime(link(1, "tt9", Some(5), 30));
        assert!(s.library.is_empty());
        assert_eq!(s.removed["kitsu:5"], 30);
    }

    #[test]
    fn two_imdb_shows_are_never_joined() {
        let mut s = Space::default();
        s.library.insert("tt1".into(), item("tt1", 10));
        s.library.insert("tt2".into(), item("tt2", 10));
        // A bad link claiming tt2 as an alias can't be expressed: aliases come
        // from anilist/mal/kitsu only. Re-linking an entry moves only those.
        s.link_anime(link(1, "tt1", None, 1));
        s.link_anime(link(1, "tt2", None, 2));
        assert!(s.library.contains_key("tt1") && s.library.contains_key("tt2"));
    }

    #[test]
    fn newer_link_for_an_entry_wins_and_older_is_ignored() {
        let mut s = Space::default();
        assert!(s.link_anime(link(1, "tt2", None, 20)));
        assert!(!s.link_anime(link(1, "tt1", None, 10)));
        assert_eq!(s.links[&1].canonical, "tt2");
        assert!(!s.link_anime(link(1, "anilist:1", None, 30)));
    }

    #[test]
    fn chains_move_everything_to_the_end() {
        let mut s = Space::default();
        s.library.insert("kitsu:5".into(), item("kitsu:5", 10));
        s.progress.insert("kitsu:5:1".into(), progress("kitsu:5", "kitsu:5:1", 10, 100.0));
        s.link_anime(link(2, "kitsu:5", None, 1));
        assert!(s.library.contains_key("kitsu:5"));
        s.link_anime(link(3, "tt9", Some(5), 2));
        assert!(s.library.contains_key("tt9") && !s.library.contains_key("kitsu:5"));
        assert_eq!(s.progress_for("anilist:2").len(), 1);
    }

    #[test]
    fn rekeying_is_deterministic() {
        let build = |order: &[(u32, &str, Option<u32>, u64)]| {
            let mut s = Space::default();
            s.library.insert("kitsu:5".into(), item("kitsu:5", 10));
            s.library.insert("kitsu:6".into(), item("kitsu:6", 15));
            for &(a, c, k, t) in order {
                s.link_anime(link(a, c, k, t));
            }
            let mut keys: Vec<_> = s.library.values().map(|i| (i.id.clone(), i.added_at)).collect();
            keys.sort();
            keys
        };
        let a = build(&[(1, "tt9", Some(5), 1), (2, "tt9", Some(6), 2)]);
        let b = build(&[(2, "tt9", Some(6), 2), (1, "tt9", Some(5), 1)]);
        assert_eq!(a, b);
        assert_eq!(a, vec![("tt9".to_string(), 10)]);
    }

    #[test]
    fn history_and_continue_watching_filter_and_order() {
        let mut s = Space::default();
        s.progress.insert("a".into(), progress("tt1", "a", 10, 990.0)); // finished
        s.progress.insert("b".into(), progress("tt2", "b", 20, 500.0)); // under way
        s.progress.insert("c".into(), progress("tt3", "c", 30, 5.0)); // barely started
        let cw: Vec<_> = s.continue_watching(0.92).into_iter().map(|p| p.video_id).collect();
        assert_eq!(cw, ["b"]);
        let h: Vec<_> = s.watch_history(0.92).into_iter().map(|p| p.video_id).collect();
        assert_eq!(h, ["b", "a"]);
    }
}
