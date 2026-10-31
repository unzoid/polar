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
}

impl Manifest {
    /// Whether this addon claims to serve `resource` for `ty` / `id`.
    pub fn serves(&self, resource: &str, ty: &str, id: &str) -> bool {
        self.resources.iter().any(|r| match r {
            ManifestResource::Name(name) => {
                name == resource
                    && self.types.iter().any(|t| t == ty)
                    && prefix_match(self.id_prefixes.as_deref(), id)
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestCatalog {
    #[serde(rename = "type")]
    pub ty: ContentType,
    pub id: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub extra: Vec<CatalogExtra>,
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
    /// Episodes (series) — empty for movies.
    #[serde(default)]
    pub videos: Vec<Video>,
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
    pub content_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub file_idx: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_url: Option<String>,
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
    pub streams: Vec<Stream>,
}

/// An external subtitle file offered by a `subtitles` addon (e.g. OpenSubtitles).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subtitle {
    #[serde(default)]
    pub id: String,
    pub url: String,
    /// ISO 639-2 (`eng`) or 639-1 (`en`), as the addon provides it.
    pub lang: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubtitlesResponse {
    #[serde(default)]
    pub subtitles: Vec<Subtitle>,
}
