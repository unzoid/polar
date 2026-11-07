use serde::{Deserialize, Serialize};

/// `movie` | `series` — kept as a string on the wire, as addons may add others.
pub type ContentType = String;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub version: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
    #[serde(default)]
    pub resources: Vec<ManifestResource>,
    #[serde(default)]
    pub types: Vec<ContentType>,
    #[serde(default)]
    pub catalogs: Vec<ManifestCatalog>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id_prefixes: Option<Vec<String>>,
    /// `None` only for manifests stored before hints were kept; the app
    /// refetches those once.
    #[serde(default)]
    pub behavior_hints: Option<BehaviorHints>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BehaviorHints {
    /// The addon serves a settings page at `<base>/configure`.
    #[serde(default)]
    pub configurable: bool,
    #[serde(default)]
    pub configuration_required: bool,
}

impl Manifest {
    /// Whether this addon claims to serve `resource` for `ty` / `id`.
    pub fn serves(&self, resource: &str, ty: &str, id: &str) -> bool {
        self.resources.iter().any(|r| match r {
            ManifestResource::Name(name) => {
                name == resource && self.types.iter().any(|t| t == ty) && prefix_match(self.id_prefixes.as_deref(), id)
            }
            ManifestResource::Full { name, types, id_prefixes } => {
                name == resource
                    && types.as_ref().unwrap_or(&self.types).iter().any(|t| t == ty)
                    && prefix_match(id_prefixes.as_deref().or(self.id_prefixes.as_deref()), id)
            }
        })
    }
}

fn prefix_match(prefixes: Option<&[String]>, id: &str) -> bool {
    prefixes.is_none_or(|p| p.iter().any(|p| id.starts_with(p.as_str())))
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ManifestResource {
    Name(String),
    #[serde(rename_all = "camelCase")]
    Full {
        name: String,
        #[serde(default)]
        types: Option<Vec<ContentType>>,
        #[serde(default)]
        id_prefixes: Option<Vec<String>>,
    },
}

/// A list of titles an addon serves (`catalog` resource), with the extra
/// arguments it takes: `genre` (with its options), `skip` (paging), `search`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(from = "RawManifestCatalog")]
pub struct ManifestCatalog {
    #[serde(rename = "type")]
    pub ty: ContentType,
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra: Vec<CatalogExtra>,
}

impl ManifestCatalog {
    /// The declared extra called `name`.
    pub fn extra(&self, name: &str) -> Option<&CatalogExtra> {
        self.extra.iter().find(|e| e.name == name)
    }

    /// Whether a request with these extra arguments is one this catalog
    /// declares: each name once and declared, every required one given.
    pub fn accepts(&self, args: &[(String, String)]) -> bool {
        let given = |name: &str| args.iter().filter(|(k, _)| k == name).count();
        args.iter().all(|(k, _)| self.extra(k).is_some() && given(k) == 1)
            && self.extra.iter().filter(|e| e.is_required).all(|e| given(&e.name) == 1)
    }
}

/// A catalog as manifests write it: `extra`, or the older `extraSupported` /
/// `extraRequired` name lists, which become `extra` entries.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RawManifestCatalog {
    #[serde(rename = "type")]
    ty: ContentType,
    id: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    extra: Vec<CatalogExtra>,
    #[serde(default)]
    extra_supported: Vec<String>,
    #[serde(default)]
    extra_required: Vec<String>,
}

impl From<RawManifestCatalog> for ManifestCatalog {
    fn from(raw: RawManifestCatalog) -> Self {
        let mut extra = raw.extra;
        if extra.is_empty() {
            let names = raw.extra_required.iter().chain(&raw.extra_supported);
            for name in names {
                if !extra.iter().any(|e: &CatalogExtra| &e.name == name) {
                    let is_required = raw.extra_required.contains(name);
                    extra.push(CatalogExtra { name: name.clone(), options: None, is_required });
                }
            }
        }
        Self { ty: raw.ty, id: raw.id, name: raw.name, extra }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogExtra {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_required: bool,
}

/// A catalog row item.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetaPreview {
    pub id: String,
    #[serde(rename = "type")]
    pub ty: ContentType,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub poster: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub background: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub logo: Option<String>,
    /// All of the title's logos, `logo` first, when the source has several
    /// (TMDB): the app chooses the one that reads on the backdrop (#215).
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub logos: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub release_info: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub imdb_rating: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub genres: Vec<String>,
}

/// Full detail for one title, including its episodes.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Meta {
    #[serde(flatten)]
    pub preview: MetaPreview,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub runtime: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub cast: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub director: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trailer_yt_id: Option<String>,
    /// Where `trailer_yt_id` comes from: `"tmdb"` when TMDB's videos chose it
    /// (played before IMDb's file), none for an addon's.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub trailer_source: Option<String>,
    /// Episodes (series) — empty for movies.
    #[serde(default)]
    pub videos: Vec<Video>,
    /// The cast with their roles and photos, where the source has them.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub people: Vec<Person>,
    /// Everything else worth knowing, for the title's Details.
    #[serde(default)]
    pub details: MetaDetails,
}

/// One cast member.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub character: Option<String>,
    /// Portrait URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub photo: Option<String>,
}

/// The fine print about a title. Every field is optional: sources differ.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct MetaDetails {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tagline: Option<String>,
    /// "Returning Series", "Ended", "Released"…
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
    /// Full release (or first air) date, `YYYY-MM-DD`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub released: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub countries: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub languages: Vec<String>,
    /// The language it was made in (ISO 639-1, e.g. `ja`), when the source says.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub original_language: Option<String>,
    /// Networks for a show, studios for a movie.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub studios: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub writers: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub awards: Option<String>,
    /// US dollars.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub budget: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revenue: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub seasons: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub episodes: Option<u32>,
    /// Number of IMDb / TMDB votes behind the rating.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub votes: Option<u64>,
    /// TMDB id, for links.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tmdb_id: Option<u64>,
}

/// One episode. `id` follows the Stremio convention `tt…:season:episode`,
/// which is what stream addons key on.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Video {
    pub id: String,
    pub title: String,
    pub season: u32,
    pub episode: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub released: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub thumbnail: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub overview: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rating: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Stream {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub yt_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_url: Option<String>,
    /// A torrent: its info hash, the file to play (`fileIdx`, 0-based) and
    /// `sources` (`tracker:<url>`, `dht:<hash>`). Played by `polar_torrent`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub info_hash: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_idx: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sources: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub behavior_hints: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CatalogResponse {
    pub metas: Vec<MetaPreview>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MetaResponse {
    pub meta: Meta,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StreamsResponse {
    #[serde(default)]
    pub streams: Vec<Stream>,
}

/// An external subtitle file offered by a `subtitles` addon (e.g. OpenSubtitles).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subtitle {
    #[serde(default)]
    pub id: String,
    pub url: String,
    /// ISO 639-2 (`eng`) or 639-1 (`en`), as the addon provides it; empty when it gives none
    /// (one such entry used to fail the whole list).
    #[serde(default)]
    pub lang: String,
}

/// What a subtitles request says about the video playing, from its stream's
/// `behaviorHints` (`videoSize`, `filename`). Empty when nothing is playing yet.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct VideoFile {
    pub size: Option<u64>,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitlesResponse {
    #[serde(default)]
    pub subtitles: Vec<Subtitle>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalogs(json: &str) -> Vec<ManifestCatalog> {
        let manifest: Manifest =
            serde_json::from_str(&format!(r#"{{"id":"a","version":"1","name":"A","catalogs":{json}}}"#)).unwrap();
        manifest.catalogs
    }

    #[test]
    fn catalog_extras_keep_options_and_required() {
        let [c] = &catalogs(
            r#"[{"type":"movie","id":"picks","name":"Picks","extra":[
                {"name":"genre","options":["Drama","Comedy"],"isRequired":true},{"name":"skip"}]}]"#,
        )[..] else {
            panic!("one catalog")
        };
        let genre = c.extra("genre").unwrap();
        assert!(genre.is_required);
        assert_eq!(genre.options.as_deref(), Some(&["Drama".to_string(), "Comedy".to_string()][..]));
        assert!(!c.extra("skip").unwrap().is_required);
        assert!(c.extra("search").is_none());
    }

    #[test]
    fn older_extra_lists_become_extras() {
        let [c] =
            &catalogs(r#"[{"type":"series","id":"s","extraSupported":["search","skip"],"extraRequired":["search"]}]"#)
                [..]
        else {
            panic!("one catalog")
        };
        let names: Vec<_> = c.extra.iter().map(|e| (e.name.as_str(), e.is_required)).collect();
        assert_eq!(names, [("search", true), ("skip", false)]);
        assert!(c.name.is_none());
    }

    #[test]
    fn extra_wins_over_the_older_lists() {
        let [c] = &catalogs(r#"[{"type":"movie","id":"m","extra":[{"name":"skip"}],"extraRequired":["search"]}]"#)[..]
        else {
            panic!("one catalog")
        };
        assert_eq!(c.extra.len(), 1);
        assert_eq!(c.extra[0].name, "skip");
    }

    #[test]
    fn a_request_takes_only_declared_extras_and_every_required_one() {
        let c =
            &catalogs(r#"[{"type":"movie","id":"m","extra":[{"name":"genre","isRequired":true},{"name":"skip"}]}]"#)[0];
        let args =
            |pairs: &[(&str, &str)]| pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect::<Vec<_>>();
        assert!(c.accepts(&args(&[("genre", "Drama")])));
        assert!(c.accepts(&args(&[("genre", "Drama"), ("skip", "100")])));
        assert!(!c.accepts(&args(&[])), "genre is required");
        assert!(!c.accepts(&args(&[("genre", "Drama"), ("search", "x")])), "search isn't declared");
        assert!(!c.accepts(&args(&[("genre", "Drama"), ("genre", "Comedy")])), "each name once");
    }

    #[test]
    fn a_catalog_serialises_as_extra_only() {
        let c = &catalogs(r#"[{"type":"movie","id":"m","extraSupported":["skip"]}]"#)[0];
        let out = serde_json::to_value(c).unwrap();
        assert_eq!(out, serde_json::json!({"type":"movie","id":"m","name":null,"extra":[{"name":"skip"}]}));
    }
}
