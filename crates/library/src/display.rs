//! Names and pictures this device fills in for titles pulled from an account,
//! which keeps none (docs/supabase-storage.md §3.6). Filling never moves a
//! record's time, so it is never pushed back, and never replaces what is there.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::space::Space;

/// A title this device has no name for.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Untitled {
    pub id: String,
    #[serde(rename = "type")]
    pub ty: String,
}

/// What was found for one title; `None` leaves that field as it is.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Display {
    pub id: String,
    pub name: Option<String>,
    pub poster: Option<String>,
    pub background: Option<String>,
}

impl Space {
    /// Every title in the library or progress without a name, most recently
    /// used first.
    pub fn untitled(&self) -> Vec<Untitled> {
        let mut newest: HashMap<&str, (u64, &str)> = HashMap::new();
        for i in self.library.values().filter(|i| i.name.is_empty()) {
            let slot = newest.entry(&i.id).or_insert((0, &i.ty));
            slot.0 = slot.0.max(i.changed_at());
        }
        for p in self.progress.values().filter(|p| p.name.is_empty()) {
            let slot = newest.entry(&p.meta_id).or_insert((0, &p.ty));
            slot.0 = slot.0.max(p.updated_at);
        }
        let mut out: Vec<_> = newest.into_iter().collect();
        out.sort_by(|a, b| b.1 .0.cmp(&a.1 .0).then(a.0.cmp(b.0)));
        out.into_iter().map(|(id, (_, ty))| Untitled { id: id.to_owned(), ty: ty.to_owned() }).collect()
    }

    /// Fills empty names and missing pictures from `found`. Returns whether
    /// anything changed.
    pub fn fill_display(&mut self, found: Vec<Display>) -> bool {
        fn set(field: &mut Option<String>, value: &Option<String>) -> bool {
            let empty = field.is_none() && value.is_some();
            if empty {
                field.clone_from(value);
            }
            empty
        }
        let mut changed = false;
        for d in found {
            if let Some(i) = self.library.get_mut(&d.id) {
                if i.name.is_empty() {
                    if let Some(name) = d.name.as_ref().filter(|n| !n.is_empty()) {
                        i.name = name.clone();
                        changed = true;
                    }
                }
                changed |= set(&mut i.poster, &d.poster);
            }
            for p in self.progress.values_mut().filter(|p| p.meta_id == d.id) {
                if p.name.is_empty() {
                    if let Some(name) = d.name.as_ref().filter(|n| !n.is_empty()) {
                        p.name = name.clone();
                        changed = true;
                    }
                }
                changed |= set(&mut p.poster, &d.poster);
                changed |= set(&mut p.background, &d.background);
            }
        }
        changed
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::space::tests::{item, progress};

    fn bare(s: &mut Space) {
        let mut i = item("tt1", 10);
        i.name = String::new();
        s.library.insert("tt1".into(), i);
        let mut p = progress("tt2", "tt2:1:1", 30, 5.0);
        p.name = String::new();
        s.progress.insert(p.video_id.clone(), p);
        let mut named = progress("tt3", "tt3", 40, 5.0);
        named.name = "Three".into();
        s.progress.insert(named.video_id.clone(), named);
    }

    #[test]
    fn untitled_lists_each_title_once_newest_first() {
        let mut s = Space::default();
        bare(&mut s);
        let mut also = progress("tt1", "tt1:1:1", 20, 1.0);
        also.name = String::new();
        s.progress.insert(also.video_id.clone(), also);
        let ids: Vec<_> = s.untitled().into_iter().map(|u| u.id).collect();
        assert_eq!(ids, ["tt2", "tt1"]);
    }

    #[test]
    fn filling_sets_only_what_is_missing_and_keeps_times() {
        let mut s = Space::default();
        bare(&mut s);
        s.library.get_mut("tt1").unwrap().poster = Some("mine".into());
        let found = vec![
            Display { id: "tt1".into(), name: Some("One".into()), poster: Some("theirs".into()), background: None },
            Display {
                id: "tt2".into(),
                name: Some("Two".into()),
                poster: Some("p".into()),
                background: Some("b".into()),
            },
            Display { id: "tt3".into(), name: Some("Not this".into()), ..Default::default() },
        ];
        assert!(s.fill_display(found));
        assert_eq!(s.library["tt1"].name, "One");
        assert_eq!(s.library["tt1"].poster.as_deref(), Some("mine"));
        assert_eq!(s.library["tt1"].updated_at, 0);
        let two = &s.progress["tt2:1:1"];
        assert_eq!(
            (two.name.as_str(), two.poster.as_deref(), two.background.as_deref()),
            ("Two", Some("p"), Some("b"))
        );
        assert_eq!(two.updated_at, 30);
        assert_eq!(s.progress["tt3"].name, "Three");
        assert!(s.untitled().is_empty());
        assert!(
            s.changes_since(31).progress.iter().all(|p| p.meta_id == "tt3") && s.changes_since(11).library.is_empty()
        );
        assert!(!s.fill_display(vec![Display { id: "tt2".into(), name: Some("Again".into()), ..Default::default() }]));
    }
}
