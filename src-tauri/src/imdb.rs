//! IMDb's GraphQL API (the one imdb.com itself uses): keyless, but it answers
//! 403 without the web client's name. Here: one title's fields by IMDb id.
//! "Not known" is `None`, never an error.

use std::sync::OnceLock;
use std::time::Duration;

use serde::de::DeserializeOwned;
use serde::Deserialize;
use serde_json::json;

const API: &str = "https://api.graphql.imdb.com/";

#[derive(Deserialize)]
struct Resp<T> {
    data: Option<Data<T>>,
}
#[derive(Deserialize)]
struct Data<T> {
    title: Option<T>,
}

/// `query` takes `$id: ID!` and asks for `title(id: $id) { … }`; `T` is that title.
pub async fn title<T: DeserializeOwned>(query: &str, imdb_id: &str) -> Option<T> {
    let valid = imdb_id.len() > 2 && imdb_id.starts_with("tt") && imdb_id[2..].bytes().all(|b| b.is_ascii_digit());
    if !valid {
        return None;
    }
    let http = client()?;
    let answer = async {
        http.post(API)
            .header("x-imdb-client-name", "imdb-web-next-localized")
            .json(&json!({ "query": query, "variables": { "id": imdb_id } }))
            .send()
            .await?
            .error_for_status()?
            .json::<Resp<T>>()
            .await
    };
    // Which title isn't logged: that would say what someone looked at.
    let resp = answer.await.map_err(|e| tracing::warn!("IMDb lookup failed: {}", e.without_url())).ok()?;
    resp.data?.title
}

/// One client for every lookup (connection reuse); `None` if TLS couldn't start.
fn client() -> Option<&'static reqwest::Client> {
    static HTTP: OnceLock<Option<reqwest::Client>> = OnceLock::new();
    HTTP.get_or_init(|| {
        reqwest::Client::builder()
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(10))
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
            .build()
            .ok()
    })
    .as_ref()
}
