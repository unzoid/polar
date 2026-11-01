//! Fallback source: the public Cinemeta addon. Used when no TMDB key is set.
//!
//! Cinemeta's lists are thin (one popularity ordering, 50 per page), so beyond
//! the plain "trending" feed it's used as a source of candidate pools that
//! [`crate::curate`] re-ranks into the other shelves.

use futures::future::join_all;
use polar_addon::{AddonClient, Meta, MetaPreview};

use crate::Result;

const BASE: &str = "https://v3-cinemeta.strem.io";
/// Cinemeta's page size.
const UPSTREAM_PAGE: u32 = 50;
/// Pages of the popularity list in a pool: the top 300.
const POOL_PAGES: u32 = 6;

pub struct Cinemeta {
    client: AddonClient,
}

impl Cinemeta {
    pub fn new() -> Self {
        Self { client: AddonClient::new() }
    }

    /// The raw popularity list ("trending"), paged.
    pub async fn top(&self, ty: &str, skip: u32, genre: Option<&str>) -> Result<Vec<MetaPreview>> {
        self.list(ty, "top", skip, genre).await
    }

    /// Candidates for curated shelves, most popular first: the top 300, then
    /// Cinemeta's featured ("imdbRating") list for titles that have dropped
    /// out of the charts.
    pub async fn pool(&self, ty: &str, genre: Option<&str>) -> Result<Vec<MetaPreview>> {
        let top = (0..POOL_PAGES).map(|p| self.list(ty, "top", p * UPSTREAM_PAGE, genre));
        let featured = (0..2).map(|p| self.list(ty, "imdbRating", p * UPSTREAM_PAGE, genre));
        gather(join_all(top.chain(featured)).await)
    }

    async fn list(&self, ty: &str, upstream: &str, skip: u32, genre: Option<&str>) -> Result<Vec<MetaPreview>> {
        let skip = skip.to_string();
        let mut extra: Vec<(&str, &str)> = Vec::new();
        if let Some(g) = genre {
            extra.push(("genre", g));
        }
        if skip != "0" {
            extra.push(("skip", &skip));
        }
        let metas = self.client.catalog(BASE, ty, upstream, &extra).await?;
        Ok(metas.into_iter().map(upgrade_images).collect())
    }

    pub async fn search(&self, ty: &str, query: &str) -> Result<Vec<MetaPreview>> {
        let metas = self.client.catalog(BASE, ty, "top", &[("search", query)]).await?;
        Ok(metas.into_iter().map(upgrade_images).collect())
    }

    pub async fn meta(&self, ty: &str, id: &str) -> Result<Meta> {
        let mut meta = self.client.meta(BASE, ty, id).await?;
        meta.preview = upgrade_images(meta.preview);
        Ok(meta)
    }
}

/// Concatenate pages in order, skipping ones that failed (a missing deep page
/// is fine); fail only if nothing came back at all.
fn gather(pages: Vec<Result<Vec<MetaPreview>>>) -> Result<Vec<MetaPreview>> {
    let mut first_err = None;
    let mut all = Vec::new();
    for page in pages {
        match page {
            Ok(items) => all.extend(items.into_iter().map(upgrade_images)),
            Err(e) => {
                first_err.get_or_insert(e);
            }
        }
    }
    match first_err {
        Some(e) if all.is_empty() => Err(e),
        _ => Ok(crate::curate::dedupe(all)),
    }
}

/// Cinemeta hands out small posters; metahub serves larger ones at the same path.
fn upgrade_images(mut m: MetaPreview) -> MetaPreview {
    if let Some(p) = &mut m.poster {
        *p = p.replace("/poster/small/", "/poster/medium/").replace("._V1_SX250", "._V1_SX500");
    }
    if let Some(b) = &mut m.background {
        *b = b.replace("/background/medium/", "/background/large/");
    }
    m
}
