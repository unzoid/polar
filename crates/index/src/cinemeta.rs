//! Fallback source: the public Cinemeta addon. Used when no TMDB key is set.

use rustio_addon::{AddonClient, Meta, MetaPreview};

use crate::Result;

const BASE: &str = "https://v3-cinemeta.strem.io";

pub struct Cinemeta {
    client: AddonClient,
}

impl Cinemeta {
    pub fn new() -> Self {
        Self { client: AddonClient::new() }
    }

    pub async fn catalog(&self, ty: &str, id: &str, skip: u32) -> Result<Vec<MetaPreview>> {
        let upstream = match id {
            "top_rated" => "imdbRating",
            _ => "top", // Cinemeta has no separate trending feed
        };
        let skip = skip.to_string();
        let extra: &[(&str, &str)] = if skip == "0" { &[] } else { &[("skip", &skip)] };
        let metas = self.client.catalog(BASE, ty, upstream, extra).await?;
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
