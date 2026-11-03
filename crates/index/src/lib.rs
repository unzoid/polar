//! polar-index — our Cinemeta.
//!
//! Serves catalogs (popular / trending / top rated) and full metadata with
//! episodes, keyed by IMDb ids (`tt…`, episodes `tt…:season:episode`) so every
//! Stremio stream addon resolves against it unchanged.
//!
//! Data comes from TMDB when an API key is configured. Without one it falls
//! back to the public Cinemeta API, so a fresh install works immediately.
//! Both paths normalise into the same [`polar_addon`] types and share one cache.

mod cache;
mod cinemeta;
pub mod curate;
mod tmdb;

use std::time::Duration;

use polar_addon::{CatalogExtra, Manifest, ManifestCatalog, ManifestResource, Meta, MetaPreview};

use cache::TtlCache;

pub const PAGE_SIZE: u32 = 20;

/// The catalogs every source must provide. Ids are stable; names are UI copy.
pub const CATALOGS: &[(&str, &str)] = &[
    ("trending", "Trending"),
    ("popular", "Popular"),
    ("top_rated", "Top Rated"),
    ("new", "New Releases"),
    ("gems", "Hidden Gems"),
    ("classics", "Classics"),
];

/// Page size of shelves the index ranks itself (from Cinemeta pools).
const CURATED_PAGE: usize = 30;
/// Genres mixed into one day's "Classics".
const CLASSIC_GENRES: usize = 3;

#[derive(Debug, thiserror::Error)]
pub enum IndexError {
    #[error("not found")]
    NotFound,
    #[error("unsupported id {0} (polar-index serves IMDb ids)")]
    UnsupportedId(String),
    #[error("upstream: {0}")]
    Upstream(String),
}

impl From<reqwest::Error> for IndexError {
    fn from(e: reqwest::Error) -> Self {
        Self::Upstream(e.to_string())
    }
}

impl From<polar_addon::AddonError> for IndexError {
    fn from(e: polar_addon::AddonError) -> Self {
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
    /// Candidate pools (several upstream pages each), shared by curated shelves.
    pools: TtlCache<String, Vec<MetaPreview>>,
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
            pools: TtlCache::new(Duration::from_secs(3 * 60 * 60), 64),
        }
    }

    /// Human name of the active data source, shown in settings.
    pub fn source(&self) -> &'static str {
        match self.backend {
            Backend::Tmdb(_) => "TMDB",
            Backend::Cinemeta(_) => "Cinemeta (fallback)",
        }
    }

    /// `genre` narrows a catalog to one genre ("Action", "Sci-Fi", …).
    pub async fn catalog(&self, ty: &str, id: &str, skip: u32, genre: Option<&str>) -> Result<Vec<MetaPreview>> {
        check_type(ty)?;
        let genre = genre.map(str::trim).filter(|g| !g.is_empty());
        let key = format!("{ty}/{id}/{}/{skip}", genre.unwrap_or(""));
        if let Some(hit) = self.catalogs.get(&key) {
            return Ok(hit);
        }
        let page = skip / PAGE_SIZE + 1;
        let metas = match &self.backend {
            Backend::Tmdb(t) => t.catalog(ty, id, page, genre).await?,
            Backend::Cinemeta(c) => match id {
                "trending" => c.top(ty, skip, genre).await?,
                "classics" => {
                    let day = curate::today();
                    let genres = match genre {
                        Some(g) => vec![g],
                        None => curate::classic_genres(ty, day, CLASSIC_GENRES),
                    };
                    let lists = futures::future::join_all(
                        genres.iter().map(|g| self.pooled(format!("{ty}/{g}"), c.pool(ty, Some(g)))),
                    )
                    .await;
                    let lists: Vec<Vec<MetaPreview>> = lists.into_iter().filter_map(|l| l.ok()).collect();
                    paged(curate::classics(&lists, day), skip)
                }
                id if curate::is_curated(id) => {
                    let pool = self.pooled(format!("{ty}/{}", genre.unwrap_or("")), c.pool(ty, genre)).await?;
                    paged(curate::curate(id, &pool, curate::today()), skip)
                }
                _ => return Err(IndexError::NotFound),
            },
        };
        self.catalogs.insert(key, metas.clone());
        Ok(metas)
    }

    /// Titles like `id`, for "Because you watched …" shelves.
    pub async fn recommend(&self, ty: &str, id: &str) -> Result<Vec<MetaPreview>> {
        check_type(ty)?;
        let key = format!("{ty}/recommend/{id}");
        if let Some(hit) = self.catalogs.get(&key) {
            return Ok(hit);
        }
        let metas = match &self.backend {
            Backend::Tmdb(t) => t.recommendations(ty, id).await?,
            Backend::Cinemeta(c) => {
                // Pools for the seed's two main genres, plus the general one
                // so close matches outside those genres still surface.
                let seed = self.meta(ty, id).await?.preview;
                let genres: Vec<Option<String>> = seed.genres.iter().take(2).cloned().map(Some).chain([None]).collect();
                let lists = futures::future::join_all(genres.iter().map(|g| {
                    let g = g.as_deref();
                    self.pooled(format!("{ty}/{}", g.unwrap_or("")), c.pool(ty, g))
                }))
                .await;
                let lists: Vec<Vec<MetaPreview>> = lists.into_iter().filter_map(|l| l.ok()).collect();
                curate::similar(&seed, &lists, curate::today()).into_iter().take(CURATED_PAGE).collect()
            }
        };
        self.catalogs.insert(key, metas.clone());
        Ok(metas)
    }

    async fn pooled(
        &self,
        key: String,
        fetch: impl std::future::Future<Output = Result<Vec<MetaPreview>>>,
    ) -> Result<Vec<MetaPreview>> {
        if let Some(hit) = self.pools.get(&key) {
            return Ok(hit);
        }
        let pool = fetch.await?;
        self.pools.insert(key, pool.clone());
        Ok(pool)
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
            id: "app.getpolar.index".into(),
            version: env!("CARGO_PKG_VERSION").into(),
            name: "Polar Index".into(),
            description: Some("Movie and series catalogs with full episode metadata.".into()),
            logo: None,
            resources: vec![ManifestResource::Name("catalog".into()), ManifestResource::Name("meta".into())],
            types: vec!["movie".into(), "series".into()],
            catalogs,
            id_prefixes: Some(vec!["tt".into()]),
            behavior_hints: None,
        }
    }
}

fn paged(list: Vec<MetaPreview>, skip: u32) -> Vec<MetaPreview> {
    list.into_iter().skip(skip as usize).take(CURATED_PAGE).collect()
}

fn check_type(ty: &str) -> Result<()> {
    match ty {
        "movie" | "series" => Ok(()),
        _ => Err(IndexError::NotFound),
    }
}
