//! A look at a stream before mpv gets it. service links (addon/Comet via
//! site and the like) redirect to a CDN link the service creates on demand,
//! and that link can answer 400 for a moment until it's ready; mpv gives up
//! on the first error ("loading failed"). And when the service can't serve
//! the file at all, addons redirect to a short "failed" / "downloading" clip
//! instead of an error. So: follow the redirect, retry a not-ready link a
//! few times, spot those clips, and hand mpv the warmed final link.

use std::time::Duration;

use reqwest::{header, StatusCode};

/// Waits between tries while a fresh link gets ready (about 5s in all).
const RETRY_AFTER_MS: [u64; 3] = [600, 1500, 3000];
/// Smaller than any real episode; the addons' status clips are ~100 KB.
const PLACEHOLDER_MAX_BYTES: u64 = 10 * 1024 * 1024;

/// The URL mpv should open, or why this source won't play.
pub async fn prepare(url: &str) -> Result<String, String> {
    let Ok(parsed) = reqwest::Url::parse(url) else { return Ok(url.to_owned()) };
    // The local bridge (p2ps) answers for itself.
    if parsed.host_str().is_some_and(|h| h == "127.0.0.1" || h == "localhost") {
        return Ok(url.to_owned());
    }
    let Ok(http) = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(20))
        .user_agent("mpv")
        .build()
    else {
        return Ok(url.to_owned());
    };

    let mut last = None;
    for attempt in 0..=RETRY_AFTER_MS.len() {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(RETRY_AFTER_MS[attempt - 1])).await;
        }
        let res = match http.get(url).header(header::RANGE, "bytes=0-1023").send().await {
            Ok(r) => r,
            // Unreachable from here: let mpv try, it reports its own error.
            Err(_) => return Ok(url.to_owned()),
        };
        let status = res.status();
        if status.is_success() {
            if is_placeholder(&res) {
                return Err("This source isn't ready on your service service (it sent a status clip instead of the video). Choose another source.".into());
            }
            return Ok(res.url().to_string());
        }
        // Not found / gone / forbidden won't change by waiting.
        if matches!(status, StatusCode::NOT_FOUND | StatusCode::GONE | StatusCode::FORBIDDEN | StatusCode::UNAUTHORIZED) {
            return Err(format!("The source answered {status}. Choose another source."));
        }
        last = Some(status);
    }
    Err(match last {
        Some(s) => format!("The source kept answering {s}. Choose another source, or try this one again in a minute."),
        None => "The source didn't answer.".into(),
    })
}

/// A small video where a whole episode or film should be.
fn is_placeholder(res: &reqwest::Response) -> bool {
    let video = res
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|t| t.starts_with("video/"));
    video && total_size(res).is_some_and(|n| n < PLACEHOLDER_MAX_BYTES)
}

/// The file's full size: `Content-Range: bytes 0-1023/136909`, or the length of a whole-file answer.
fn total_size(res: &reqwest::Response) -> Option<u64> {
    if res.status() == StatusCode::PARTIAL_CONTENT {
        let range = res.headers().get(header::CONTENT_RANGE)?.to_str().ok()?;
        return range.rsplit('/').next()?.trim().parse().ok();
    }
    res.content_length()
}

#[cfg(test)]
mod tests {
    /// addon's own "failed" clip. Network: `cargo test -p polar streamcheck -- --ignored`.
    #[tokio::test]
    #[ignore]
    async fn spots_status_clip() {
        let r = super::prepare("https://addon.strem.fun/videos/failed_unexpected_v3.mp4").await;
        assert!(r.is_err(), "{r:?}");
    }
}
