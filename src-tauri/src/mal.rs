//! MyAnimeList's API for a profile's linked list (#84). MAL doesn't answer the
//! web view's cross-origin requests, so the list code (src/lib/lists/malList.ts)
//! asks through here. Only MAL's token endpoint and the few list paths Polarity
//! uses are let through, with only the fields they take; the tokens are the
//! caller's, sent once and never kept or logged here.

use std::time::Duration;

use serde::Serialize;

const API: &str = "https://api.myanimelist.net/v2/";
const TOKEN: &str = "https://myanimelist.net/v1/oauth2/token";
/// A whole list of a thousand entries with their fields is well under this.
const MAX_BODY: usize = 8 << 20;
const MAX_VALUE: usize = 4096;

/// MAL's answer, passed on as it came: the list code reads the status and the JSON.
#[derive(Debug, Serialize)]
pub struct Answer {
    pub status: u16,
    pub body: String,
}

pub struct Mal {
    http: reqwest::Client,
}

impl Default for Mal {
    fn default() -> Self {
        Self {
            http: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(5))
                .timeout(Duration::from_secs(20))
                .redirect(reqwest::redirect::Policy::none())
                .user_agent(concat!("polarity/", env!("CARGO_PKG_VERSION")))
                .build()
                .expect("http client"),
        }
    }
}

/// The list paths Polarity uses, by method: who is signed in, the list, one
/// anime's entry, and changing or removing it.
fn allowed(method: &str, path: &str) -> bool {
    let anime = |rest: &str| -> Option<String> {
        let rest = rest.strip_prefix("anime/")?;
        let (id, tail) = rest.split_once('/').map_or((rest, ""), |(id, tail)| (id, tail));
        let digits = !id.is_empty() && id.len() <= 10 && id.bytes().all(|b| b.is_ascii_digit());
        digits.then(|| tail.to_owned())
    };
    match method {
        "GET" => path == "users/@me" || path == "users/@me/animelist" || anime(path).as_deref() == Some(""),
        "PATCH" | "DELETE" => anime(path).as_deref() == Some("my_list_status"),
        _ => false,
    }
}

const QUERY_KEYS: &[&str] = &["fields", "limit", "offset", "sort", "nsfw", "status"];
const LIST_FIELDS: &[&str] = &["status", "score", "num_watched_episodes", "is_rewatching", "num_times_rewatched"];
const TOKEN_FIELDS: &[&str] = &["client_id", "grant_type", "code", "code_verifier", "redirect_uri", "refresh_token"];

fn fits(pairs: &[(String, String)], keys: &[&str]) -> bool {
    pairs.len() <= 16 && pairs.iter().all(|(k, v)| keys.contains(&k.as_str()) && v.len() <= MAX_VALUE)
}

/// Why a request isn't sent, or `None` when it may be.
pub fn refusal(
    method: &str,
    path: &str,
    query: &[(String, String)],
    form: &[(String, String)],
) -> Option<&'static str> {
    if !allowed(method, path) {
        return Some("not a MyAnimeList list path");
    }
    if !fits(query, QUERY_KEYS) {
        return Some("not a list query");
    }
    if !(form.is_empty() || method == "PATCH" && fits(form, LIST_FIELDS)) {
        return Some("not a list change");
    }
    None
}

/// Why a token request isn't sent, or `None` when it may be.
pub fn token_refusal(form: &[(String, String)]) -> Option<&'static str> {
    let grant = form.iter().find(|(k, _)| k == "grant_type").map(|(_, v)| v.as_str());
    if !fits(form, TOKEN_FIELDS) || !matches!(grant, Some("authorization_code" | "refresh_token")) {
        return Some("not a MyAnimeList sign-in");
    }
    None
}

impl Mal {
    /// Calls `API` + `path` with the profile's `token`.
    pub async fn api(
        &self,
        method: &str,
        path: &str,
        query: &[(String, String)],
        form: &[(String, String)],
        token: &str,
    ) -> Result<Answer, String> {
        if let Some(why) = refusal(method, path, query, form) {
            return Err(why.to_owned());
        }
        if token.is_empty() || token.len() > MAX_VALUE || token.chars().any(|c| c.is_whitespace() || c.is_control()) {
            return Err("no sign-in".to_owned());
        }
        let method = reqwest::Method::from_bytes(method.as_bytes()).map_err(|_| "bad method".to_owned())?;
        let mut req = self.http.request(method, format!("{API}{path}")).bearer_auth(token).query(query);
        if !form.is_empty() {
            req = req.form(form);
        }
        answer(req.send().await.map_err(|e| e.without_url().to_string())?).await
    }

    /// Trades a sign-in code, or a refresh token, for new tokens.
    pub async fn token(&self, form: &[(String, String)]) -> Result<Answer, String> {
        if let Some(why) = token_refusal(form) {
            return Err(why.to_owned());
        }
        answer(self.http.post(TOKEN).form(form).send().await.map_err(|e| e.without_url().to_string())?).await
    }
}

async fn answer(res: reqwest::Response) -> Result<Answer, String> {
    let status = res.status().as_u16();
    if res.content_length().is_some_and(|n| n as usize > MAX_BODY) {
        return Err("MyAnimeList's answer is too large".to_owned());
    }
    let bytes = res.bytes().await.map_err(|e| e.without_url().to_string())?;
    if bytes.len() > MAX_BODY {
        return Err("MyAnimeList's answer is too large".to_owned());
    }
    Ok(Answer { status, body: String::from_utf8_lossy(&bytes).into_owned() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pairs(p: &[(&str, &str)]) -> Vec<(String, String)> {
        p.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn lets_through_only_the_list_paths() {
        assert!(allowed("GET", "users/@me"));
        assert!(allowed("GET", "users/@me/animelist"));
        assert!(allowed("GET", "anime/123"));
        assert!(allowed("PATCH", "anime/123/my_list_status"));
        assert!(allowed("DELETE", "anime/123/my_list_status"));
        assert!(!allowed("GET", "users/someone/animelist"));
        assert!(!allowed("DELETE", "anime/123"));
        assert!(!allowed("PATCH", "anime/12a/my_list_status"));
        assert!(!allowed("GET", "anime/../users/@me"));
        assert!(!allowed("GET", "anime/"));
        assert!(!allowed("POST", "anime/1/my_list_status"));
        assert!(!allowed("GET", "forum/topics"));
    }

    #[test]
    fn checks_queries_and_forms() {
        assert_eq!(
            refusal("GET", "users/@me/animelist", &pairs(&[("limit", "50"), ("sort", "list_updated_at")]), &[]),
            None
        );
        assert!(refusal("GET", "users/@me/animelist", &pairs(&[("redirect", "x")]), &[]).is_some());
        assert_eq!(
            refusal(
                "PATCH",
                "anime/1/my_list_status",
                &[],
                &pairs(&[("status", "watching"), ("num_watched_episodes", "3")])
            ),
            None
        );
        assert!(refusal("PATCH", "anime/1/my_list_status", &[], &pairs(&[("comments", "x")])).is_some());
        assert!(refusal("GET", "anime/1", &[], &pairs(&[("status", "watching")])).is_some());
        let long = "x".repeat(MAX_VALUE + 1);
        assert!(refusal("GET", "anime/1", &pairs(&[("fields", &long)]), &[]).is_some());
    }

    #[test]
    fn token_requests_are_sign_ins_only() {
        assert_eq!(
            token_refusal(&pairs(&[("grant_type", "refresh_token"), ("refresh_token", "TOKEN"), ("client_id", "xxx")])),
            None
        );
        assert_eq!(
            token_refusal(&pairs(&[("grant_type", "authorization_code"), ("code", "xxx"), ("code_verifier", "xxx")])),
            None
        );
        assert!(token_refusal(&pairs(&[("grant_type", "password"), ("username", "x")])).is_some());
        assert!(token_refusal(&pairs(&[("code", "xxx")])).is_some());
    }
}
