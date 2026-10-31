//! rustio-index — our Cinemeta.
//!
//! Serves catalogs (popular / trending / top rated) and full metadata with
//! episodes, keyed by IMDb ids (`tt…`, episodes `tt…:season:episode`) so every
//! Stremio stream addon resolves against it unchanged.
//!
//! Data comes from TMDB when an API key is configured. Without one it falls
//! back to the public Cinemeta API, so a fresh install works immediately.
//! Both paths normalise into the same [`rustio_addon`] types and share one cache.

mod cache;
mod cinemeta;
mod tmdb;

use std::time::Duration;

use rustio_addon::{CatalogExtra, Manifest, ManifestCatalog, ManifestResource, Meta, MetaPreview};

use cache::TtlCache;

pub const PAGE_SIZE: u32 = 20;

/// The catalogs every source must provide. Ids are stable; names are UI copy.
pub const CATALOGS: &[(&str, &str)] = &[
    ("trending", "Trending"),
    ("popular", "Popular"),
    ("top_rated", "Top Rated"),
];

#[derive(Debug, thiserror::Error)]
pub enum IndexError {
    #[error("not found")]
    NotFound,
    #[error("unsupported id {0} (rustio-index serves IMDb ids)")]
    UnsupportedId(String),
    #[error("upstream: {0}")]
    Upstream(String),
}

impl From<reqwest::Error> for IndexError {
    fn from(e: reqwest::Error) -> Self {
        Self::Upstream(e.to_string())
    }
}

impl From<rustio_addon::AddonError> for IndexError {
    fn from(e: rustio_addon::AddonError) -> Self {
        Self::Upstream(e.to_string())
    }
}

pub type Result<T> = std::result::Result<T, IndexError>;

#[derive(Debug, Clone, Default)]
pub struct IndexConfig {
    /// TMDB v3 API key or v4 read access token.
    pub tmdb_key: Option<String>,
    /// TMDB language, e.g. `en-US`.
    pub language: Option<String>,
}

enum Backend {
    Tmdb(tmdb::Tmdb),
    Cinemeta(cinemeta::Cinemeta),
}

pub struct Indexer {
    backend: Backend,
    catalogs: TtlCache<String, Vec<MetaPreview>>,
    metas: TtlCache<String, Meta>,
}

impl Indexer {
    pub fn new(config: IndexConfig) -> Self {
        let backend = match config.tmdb_key.filter(|k| !k.trim().is_empty()) {
            Some(key) => Backend::Tmdb(tmdb::Tmdb::new(key, config.language)),
            None => Backend::Cinemeta(cinemeta::Cinemeta::new()),
        };
        Self {
            backend,
            catalogs: TtlCache::new(Duration::from_secs(60 * 60), 256),
            metas: TtlCache::new(Duration::from_secs(6 * 60 * 60), 2048),
        }
    }

    /// Human name of the active data source, shown in settings.
    pub fn source(&self) -> &'static str {
        match self.backend {
            Backend::Tmdb(_) => "TMDB",
            Backend::Cinemeta(_) => "Cinemeta (fallback)",
        }
    }

    pub async fn catalog(&self, ty: &str, id: &str, skip: u32) -> Result<Vec<MetaPreview>> {
        check_type(ty)?;
        let key = format!("{ty}/{id}/{skip}");
        if let Some(hit) = self.catalogs.get(&key) {
            return Ok(hit);
        }
        let page = skip / PAGE_SIZE + 1;
        let metas = match &self.backend {
            Backend::Tmdb(t) => t.catalog(ty, id, page).await?,
            Backend::Cinemeta(c) => c.catalog(ty, id, skip).await?,
        };
        self.catalogs.insert(key, metas.clone());
        Ok(metas)
    }

    pub async fn search(&self, ty: &str, query: &str) -> Result<Vec<MetaPreview>> {
        check_type(ty)?;
        let query = query.trim();
        if query.is_empty() {
            return Ok(Vec::new());
        }
        let key = format!("{ty}/search/{}", query.to_lowercase());
        if let Some(hit) = self.catalogs.get(&key) {
            return Ok(hit);
        }
        let metas = match &self.backend {
            Backend::Tmdb(t) => t.search(ty, query).await?,
            Backend::Cinemeta(c) => c.search(ty, query).await?,
        };
        self.catalogs.insert(key, metas.clone());
        Ok(metas)
    }

    pub async fn meta(&self, ty: &str, id: &str) -> Result<Meta> {
        check_type(ty)?;
        if !id.starts_with("tt") {
            return Err(IndexError::UnsupportedId(id.into()));
        }
        let key = format!("{ty}/{id}");
        if let Some(hit) = self.metas.get(&key) {
            return Ok(hit);
        }
        let meta = match &self.backend {
            Backend::Tmdb(t) => t.meta(ty, id).await?,
            Backend::Cinemeta(c) => c.meta(ty, id).await?,
        };
        self.metas.insert(key, meta.clone());
        Ok(meta)
    }

    /// The addon manifest, so the index can also be mounted as a Stremio addon.
    pub fn manifest() -> Manifest {
        let catalogs = ["movie", "series"]
            .iter()
            .flat_map(|ty| {
                CATALOGS.iter().map(move |(id, name)| ManifestCatalog {
                    ty: (*ty).into(),
                    id: (*id).into(),
                    name: Some((*name).into()),
                    extra: vec![
                        CatalogExtra { name: "search".into(), options: None, is_required: false },
                        CatalogExtra { name: "skip".into(), options: None, is_required: false },
                    ],
                })
            })
            .collect();
        Manifest {
            id: "app.rustio.index".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            name: "Rustio Index".into(),
            description: Some("Movie and series catalogs with full episode metadata.".into()),
            logo: None,
            resources: vec![
                ManifestResource::Name("catalog".into()),
                ManifestResource::Name("meta".into()),
            ],
            types: vec!["movie".into(), "series".into()],
            catalogs,
            id_prefixes: Some(vec!["tt".into()]),
        }
    }
}

fn check_type(ty: &str) -> Result<()> {
    match ty {
        "movie" | "series" => Ok(()),
        _ => Err(IndexError::NotFound),
    }
}
