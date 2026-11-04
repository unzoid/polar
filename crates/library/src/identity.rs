//! Title identity: which id a show is known by, and how other ids for the
//! same show lead to it. The Rust half of `src/lib/library/identity.ts`; see
//! `docs/anime-identity.md`.
//!
//! Canonical ids are what every store keys titles by: an IMDb id (`tt…`) or,
//! for anime with no IMDb page Polar plays from, `kitsu:N`. `anilist:N`,
//! `mal:N`, and `kitsu:N` once an IMDb page is known, are aliases of a
//! canonical id. An IMDb id is never an alias, so two IMDb shows are never
//! joined into one.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

/// `tt` followed by digits.
pub fn is_imdb(id: &str) -> bool {
    id.len() > 2 && id.starts_with("tt") && id[2..].bytes().all(|b| b.is_ascii_digit())
}

/// `kitsu:N`.
fn is_kitsu(id: &str) -> bool {
    id.strip_prefix("kitsu:").is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

/// Whether stores may key a title by this id.
pub fn is_canonical_kind(id: &str) -> bool {
    is_imdb(id) || is_kitsu(id)
}

/// What Polar knows links one anime together: its AniList entry, and the ids
/// of the same show elsewhere. `canonical` is the id Polar plays it from.
/// One per AniList entry; the newest decision about an entry wins.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnimeLink {
    pub canonical: String,
    pub anilist: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mal: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kitsu: Option<u32>,
    /// ms.
    pub updated_at: u64,
}

impl AnimeLink {
    /// Whether the link can be stored: its canonical id is one stores key by.
    pub fn is_valid(&self) -> bool {
        is_canonical_kind(&self.canonical)
    }

    /// Whether two links say the same thing about an entry, whenever they
    /// were made.
    pub fn same_target(&self, other: &AnimeLink) -> bool {
        (self.anilist, &self.canonical, self.mal, self.kitsu)
            == (other.anilist, &other.canonical, other.mal, other.kitsu)
    }

    /// The alias → canonical pairs the link stands for.
    pub fn aliases(&self) -> Vec<(String, String)> {
        let mut out = vec![(format!("anilist:{}", self.anilist), self.canonical.clone())];
        if let Some(mal) = self.mal {
            out.push((format!("mal:{mal}"), self.canonical.clone()));
        }
        if let Some(kitsu) = self.kitsu.map(|k| format!("kitsu:{k}")) {
            if kitsu != self.canonical {
                out.push((kitsu, self.canonical.clone()));
            }
        }
        out
    }
}

/// Following aliases more than this many steps means a loop; the id is then
/// left as it is.
const MAX_STEPS: usize = 4;

/// Alias → target, built from a set of links.
#[derive(Debug, Default, Clone)]
pub struct Aliases(HashMap<String, String>);

impl Aliases {
    /// When two links claim the same alias, the newer one wins (an AniList
    /// entry re-linked to the right show replaces the old answer). Ties go to
    /// the larger AniList id, so every device builds the same table.
    pub fn from_links<'a>(links: impl IntoIterator<Item = &'a AnimeLink>) -> Self {
        let mut sorted: Vec<_> = links.into_iter().filter(|l| l.is_valid()).collect();
        sorted.sort_by_key(|l| (l.updated_at, l.anilist));
        let mut table = HashMap::new();
        for link in sorted {
            for (from, to) in link.aliases() {
                if !is_imdb(&from) {
                    table.insert(from, to);
                }
            }
        }
        Self(table)
    }

    /// The canonical id for any title id: itself if nothing points elsewhere.
    pub fn canonical<'a>(&'a self, id: &'a str) -> &'a str {
        let mut cur = id;
        for _ in 0..MAX_STEPS {
            if is_imdb(cur) {
                return cur;
            }
            match self.0.get(cur) {
                Some(next) if next != cur => cur = next,
                _ => return cur,
            }
        }
        id
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    pub fn link(anilist: u32, canonical: &str, kitsu: Option<u32>, at: u64) -> AnimeLink {
        AnimeLink { canonical: canonical.into(), anilist, mal: Some(anilist + 1000), kitsu, updated_at: at }
    }

    #[test]
    fn same_target_ignores_the_time() {
        assert!(link(1, "tt1", Some(2), 10).same_target(&link(1, "tt1", Some(2), 99)));
        assert!(!link(1, "tt1", Some(2), 10).same_target(&link(1, "tt1", None, 10)));
        assert!(!link(1, "tt1", None, 10).same_target(&link(1, "tt2", None, 10)));
    }

    #[test]
    fn id_kinds() {
        assert!(is_imdb("tt0000103"));
        assert!(!is_imdb("tt") && !is_imdb("tt12a") && !is_imdb("kitsu:1"));
        assert!(is_canonical_kind("kitsu:7442"));
        assert!(!is_canonical_kind("anilist:1") && !is_canonical_kind("kitsu:") && !is_canonical_kind("kitsu:1:2"));
    }

    #[test]
    fn aliases_lead_to_the_canonical_id() {
        let a = Aliases::from_links(&[link(1, "tt100", Some(7), 10)]);
        assert_eq!(a.canonical("anilist:1"), "tt100");
        assert_eq!(a.canonical("mal:1001"), "tt100");
        assert_eq!(a.canonical("kitsu:7"), "tt100");
        assert_eq!(a.canonical("tt100"), "tt100");
        assert_eq!(a.canonical("kitsu:8"), "kitsu:8");
    }

    #[test]
    fn chains_resolve_and_loops_stop() {
        // anilist:2 → kitsu:5 (no IMDb page yet), and kitsu:5 → tt9 from another entry.
        let a = Aliases::from_links(&[link(2, "kitsu:5", None, 10), link(3, "tt9", Some(5), 20)]);
        assert_eq!(a.canonical("anilist:2"), "tt9");
        let looped = Aliases::from_links(&[link(4, "kitsu:6", Some(7), 1), link(5, "kitsu:7", Some(6), 2)]);
        assert_eq!(looped.canonical("kitsu:6"), "kitsu:6");
    }

    #[test]
    fn newest_link_wins_and_imdb_ids_are_never_aliases() {
        let a = Aliases::from_links(&[link(1, "tt100", None, 10), link(1, "tt200", None, 20)]);
        assert_eq!(a.canonical("anilist:1"), "tt200");
        // Even a link that names a `tt` id as its Kitsu side can't join two IMDb shows.
        assert_eq!(a.canonical("tt100"), "tt100");
    }

    #[test]
    fn invalid_links_are_ignored() {
        let a = Aliases::from_links(&[link(1, "anilist:1", None, 10)]);
        assert!(a.is_empty());
    }
}
