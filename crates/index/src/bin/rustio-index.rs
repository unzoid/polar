//! Standalone addon server: `cargo run -p rustio-index --features server`
//! then install `http://127.0.0.1:7000/manifest.json` in rustio or Stremio.
//!
//! Env: `PORT` (default 7000), `TMDB_API_KEY` (optional), `TMDB_LANGUAGE`.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::{Json, Router};
use rustio_index::{IndexConfig, IndexError, Indexer, PAGE_SIZE};
use serde_json::json;
use tower_http::cors::CorsLayer;

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into()))
        .init();

    let indexer = Arc::new(Indexer::new(IndexConfig {
        tmdb_key: std::env::var("TMDB_API_KEY").ok(),
        language: std::env::var("TMDB_LANGUAGE").ok(),
    }));
    tracing::info!(source = indexer.source(), "rustio-index starting");

    let app = Router::new()
        .route("/manifest.json", get(|| async { Json(Indexer::manifest()) }))
        .route("/catalog/{ty}/{*rest}", get(catalog))
        .route("/meta/{ty}/{*rest}", get(meta))
        .layer(CorsLayer::permissive())
        .with_state(indexer);

    let port = std::env::var("PORT").unwrap_or_else(|_| "7000".into());
    let listener = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}")).await.unwrap();
    tracing::info!("listening on http://127.0.0.1:{port}/manifest.json");
    axum::serve(listener, app).await.unwrap();
}

/// `top.json` or `top/search=sandglass&skip=20.json` → (id, extras)
fn parse_rest(rest: &str) -> (String, Vec<(String, String)>) {
    let rest = rest.trim_end_matches(".json");
    let (id, extra) = rest.split_once('/').unwrap_or((rest, ""));
    let extras = extra
        .split('&')
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (k.to_owned(), urlencoding::decode(v).map(|v| v.into_owned()).unwrap_or_default()))
        .collect();
    (urlencoding::decode(id).map(|i| i.into_owned()).unwrap_or_default(), extras)
}

async fn catalog(State(ix): State<Arc<Indexer>>, Path((ty, rest)): Path<(String, String)>) -> Response {
    let (id, extras) = parse_rest(&rest);
    let get = |k: &str| extras.iter().find(|(key, _)| key == k).map(|(_, v)| v.as_str());
    let result = match get("search") {
        Some(q) => ix.search(&ty, q).await,
        None => {
            let skip = get("skip").and_then(|s| s.parse().ok()).unwrap_or(0);
            ix.catalog(&ty, &id, skip - skip % PAGE_SIZE).await
        }
    };
    match result {
        Ok(metas) => Json(json!({ "metas": metas })).into_response(),
        Err(e) => error(e),
    }
}

async fn meta(State(ix): State<Arc<Indexer>>, Path((ty, rest)): Path<(String, String)>) -> Response {
    let (id, _) = parse_rest(&rest);
    match ix.meta(&ty, &id).await {
        Ok(meta) => Json(json!({ "meta": meta })).into_response(),
        Err(e) => error(e),
    }
}

fn error(e: IndexError) -> Response {
    let status = match e {
        IndexError::NotFound | IndexError::UnsupportedId(_) => StatusCode::NOT_FOUND,
        IndexError::Upstream(_) => StatusCode::BAD_GATEWAY,
    };
    (status, Json(json!({ "error": e.to_string() }))).into_response()
}
