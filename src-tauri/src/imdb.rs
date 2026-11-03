//! IMDb's GraphQL API (the one imdb.com itself uses): keyless, but it answers
//! 403 without the web client's name. Here: one title's fields by IMDb id.
//! "Not known" is `None`, never an error.

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
    let http = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")
        .build()
        .ok()?;
    let resp: Resp<T> = http
        .post(API)
        .header("x-imdb-client-name", "imdb-web-next-localized")
        .json(&json!({ "query": query, "variables": { "id": imdb_id } }))
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    resp.data?.title
}
