//! A look at a stream before the player gets it. Some add-ons redirect to a CDN
//! link created on demand, and that link can answer 400 for a moment until it's
//! ready; mpv gives up on the first error ("loading failed"). And when the file
//! can't be served at all, some add-ons redirect to a short "failed" /
//! "downloading" clip instead of an error. So: follow the redirects, retry a
//! not-ready link a few times, spot those clips, and hand the player the warmed
//! final link.
//!
//! Every step is reported as a [`ProbeEvent`] while it happens, for the player's
//! loading screen. Events name hosts only, never paths or queries: add-on and
//! CDN links often carry account tokens or the add-on's config there.

use std::net::IpAddr;
use std::time::{Duration, Instant};

use reqwest::{header, StatusCode, Url};
use serde::Serialize;

/// One step of the probe, as it happens.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ProbeEvent {
    /// A request went out; `attempt` counts tries of the whole chain, from 1.
    Request { host: String, attempt: u32 },
    /// The server sent us on to another link.
    Redirect { from: String, to: String, status: u16, ms: u64 },
    /// The server answered (not a redirect).
    Response {
        host: String,
        status: u16,
        /// "Not Found", "Service Unavailable"…
        reason: Option<String>,
        /// Without parameters: `video/x-matroska`.
        content_type: Option<String>,
        /// The whole file's size in bytes, when the server says.
        size: Option<u64>,
        ms: u64,
    },
    /// Waiting before the next try: the link may not be ready yet.
    Retry { after_ms: u64 },
    /// No answer at all (name lookup, connection, TLS, timeout). The player still
    /// tries the link itself and reports its own error.
    Unreachable { host: String, error: String, ms: u64 },
    /// Not checked (a server on this machine answers for itself).
    Skipped { reason: String },
}

/// Timings of a probe. [`Probe::default`] is what the app uses; tests shorten it.
#[derive(Debug, Clone)]
pub struct Probe {
    /// Waits between tries while a fresh link gets ready.
    pub retry_after: Vec<Duration>,
    pub connect_timeout: Duration,
    pub timeout: Duration,
    /// The whole check, retries and redirects included: past it the player tries the link as it is
    /// (a slow server answering 503 four times could otherwise hold playback for over a minute).
    pub deadline: Duration,
    /// Sent with every request, redirects included (`polar_player::headers` picks them).
    pub headers: Vec<(String, String)>,
}

impl Default for Probe {
    fn default() -> Self {
        Self {
            // About 5 s in all.
            retry_after: [600, 1500, 3000].map(Duration::from_millis).to_vec(),
            connect_timeout: Duration::from_secs(8),
            timeout: Duration::from_secs(20),
            deadline: Duration::from_secs(25),
            headers: Vec::new(),
        }
    }
}

/// Whether a source's link would start playing now (#21), from one look at it ahead of time:
/// the same request pressing Play makes, once, with a short deadline and no retries.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum Readiness {
    /// It answered with the video, `ms` after the request went out (redirects included).
    Ready { ms: u64 },
    /// It didn't: why, in a few plain words ("Not ready at the source", "Didn't answer").
    NotReady { reason: String },
    /// No answer before [`READY_DEADLINE`]. Not a failure: a server that opens the file on demand
    /// can take seconds for the first byte, and the player waits far longer than this check.
    Slow { ms: u64 },
    /// Not checked (not a web link).
    Unchecked,
}

/// How long a readiness check waits: a link slower than this isn't "ready to play".
pub const READY_DEADLINE: Duration = Duration::from_secs(3);

/// One look at `url` with the player's `headers`: see [`Readiness`].
pub async fn readiness(url: &str, headers: Vec<(String, String)>) -> Readiness {
    let probe = Probe {
        retry_after: Vec::new(),
        connect_timeout: READY_DEADLINE,
        timeout: READY_DEADLINE,
        deadline: READY_DEADLINE,
        headers,
    };
    probe.readiness(url).await
}

impl Probe {
    /// [`readiness`] with these timings (tests shorten them). A server on this machine is
    /// checked too: it's quick, and a self-hosted one is a source like any other.
    pub async fn readiness(&self, url: &str) -> Readiness {
        let Ok(start) = Url::parse(url) else { return Readiness::Unchecked };
        let started = Instant::now();
        let mut events = Vec::new();
        let result = self.check(start, &mut |e| events.push(e)).await;
        judge(result, &events, ms(started))
    }
}

/// What a probe's outcome and steps say about the link being ready.
fn judge(result: Result<String, String>, events: &[ProbeEvent], ms: u64) -> Readiness {
    let not_ready = |reason: &str| Readiness::NotReady { reason: reason.into() };
    let response = events.iter().rev().find_map(|e| match e {
        ProbeEvent::Response { status, content_type, .. } => Some((*status, content_type.as_deref())),
        _ => None,
    });
    match (result, events.last()) {
        (Err(why), _) if why.contains("placeholder") => not_ready("Not ready at the source"),
        (Err(_), _) => match response {
            Some((status, _)) => Readiness::NotReady { reason: format!("The link answered {status}") },
            None => not_ready("Didn't answer"),
        },
        (Ok(_), Some(ProbeEvent::Skipped { .. })) | (Ok(_), None) => Readiness::Unchecked,
        (Ok(_), Some(ProbeEvent::Unreachable { error, .. })) if error == LATE || error.starts_with("timed out") => {
            Readiness::Slow { ms }
        }
        (Ok(_), Some(ProbeEvent::Unreachable { .. })) => not_ready("Didn't answer"),
        (Ok(_), _) => match response {
            Some((_, Some(t))) if is_page(t) => not_ready("Answered with a page, not a video"),
            Some(_) => Readiness::Ready { ms },
            None => Readiness::Unchecked,
        },
    }
}

/// A web page or an API's answer rather than something to play. HLS and DASH manifests are text and
/// XML too, and play.
fn is_page(content_type: &str) -> bool {
    let t = content_type.to_ascii_lowercase();
    let manifest = t.contains("mpegurl") || t.contains("dash+xml");
    !manifest && (t.starts_with("text/") || t.contains("json") || t.contains("xml"))
}

/// What [`ProbeEvent::Unreachable`] says when the check's deadline passed before an answer.
const LATE: &str = "no answer in time";

/// Smaller than any real episode; the addons' status clips are ~100 KB.
const PLACEHOLDER_MAX_BYTES: u64 = 10 * 1024 * 1024;
const MAX_REDIRECTS: usize = 10;

/// The URL the player should open, or why this source won't play (in plain words).
/// `headers` are the add-on's, as the player will send them.
pub async fn prepare(url: &str, headers: Vec<(String, String)>, on: impl FnMut(ProbeEvent)) -> Result<String, String> {
    Probe { headers, ..Probe::default() }.run(url, on).await
}

impl Probe {
    pub async fn run(&self, url: &str, mut on: impl FnMut(ProbeEvent)) -> Result<String, String> {
        let Ok(start) = Url::parse(url) else { return Ok(url.to_owned()) };
        if is_this_machine(&start) {
            on(ProbeEvent::Skipped { reason: "a server on this computer".into() });
            return Ok(url.to_owned());
        }
        self.check(start, &mut on).await
    }

    /// [`Probe::run`] without the shortcut for servers on this machine (tests serve from one).
    async fn check(&self, start: Url, on: &mut impl FnMut(ProbeEvent)) -> Result<String, String> {
        let Ok(http) = reqwest::Client::builder()
            .connect_timeout(self.connect_timeout)
            .timeout(self.timeout)
            .user_agent("mpv")
            // Followed by hand, so each hop can be reported.
            .redirect(reqwest::redirect::Policy::none())
            .build()
        else {
            return Ok(start.into());
        };

        let until = Instant::now() + self.deadline;
        let late = |url: &Url, on: &mut dyn FnMut(ProbeEvent)| {
            on(ProbeEvent::Unreachable {
                host: host_label(url),
                error: LATE.into(),
                ms: self.deadline.as_millis() as u64,
            });
            Ok(url.to_string())
        };
        let mut last = None;
        for attempt in 0..=self.retry_after.len() {
            if attempt > 0 {
                let wait = self.retry_after[attempt - 1];
                if Instant::now() + wait >= until {
                    break;
                }
                on(ProbeEvent::Retry { after_ms: wait.as_millis() as u64 });
                tokio::time::sleep(wait).await;
            }
            let mut url = start.clone();
            on(ProbeEvent::Request { host: host_label(&url), attempt: attempt as u32 + 1 });
            let mut hops = 0;
            let (res, took) = loop {
                let sent = Instant::now();
                let Some(left) = until.checked_duration_since(sent).filter(|d| !d.is_zero()) else {
                    return late(&url, on);
                };
                let mut req =
                    http.get(url.clone()).header(header::RANGE, "bytes=0-1023").timeout(left.min(self.timeout));
                for (k, v) in &self.headers {
                    req = req.header(k.as_str(), v.as_str());
                }
                let res = match req.send().await {
                    Ok(r) => r,
                    Err(e) => {
                        on(ProbeEvent::Unreachable { host: host_label(&url), error: describe(&e), ms: ms(sent) });
                        // Unreachable from here: let the player try, it reports its own error.
                        return Ok(url.into());
                    }
                };
                let status = res.status();
                let next = status
                    .is_redirection()
                    .then(|| res.headers().get(header::LOCATION)?.to_str().ok().and_then(|l| url.join(l).ok()))
                    .flatten();
                let Some(next) = next else { break (res, ms(sent)) };
                // The player opens whatever this ends on: a file, a share or one of mpv's own protocols never.
                if !matches!(next.scheme(), "http" | "https") {
                    return Err("The source sent the player to a link it doesn't open. Choose another source.".into());
                }
                hops += 1;
                if hops > MAX_REDIRECTS {
                    return Err(
                        "The source sent the player round in circles (too many redirects). Choose another source."
                            .into(),
                    );
                }
                on(ProbeEvent::Redirect {
                    from: host_label(&url),
                    to: host_label(&next),
                    status: status.as_u16(),
                    ms: ms(sent),
                });
                url = next;
            };
            let status = res.status();
            on(ProbeEvent::Response {
                host: host_label(&url),
                status: status.as_u16(),
                reason: status.canonical_reason().map(str::to_owned),
                content_type: content_type(&res),
                size: total_size(&res),
                ms: took,
            });
            if status.is_success() {
                if is_placeholder(&res) {
                    return Err(
                        "This source isn't ready (it sent a placeholder clip instead of the video). Choose another source."
                            .into(),
                    );
                }
                return Ok(url.into());
            }
            // Not found / gone / forbidden won't change by waiting.
            if matches!(
                status,
                StatusCode::NOT_FOUND | StatusCode::GONE | StatusCode::FORBIDDEN | StatusCode::UNAUTHORIZED
            ) {
                return Err(format!("The source answered {status}. Choose another source."));
            }
            last = Some(status);
        }
        Err(match last {
            Some(s) => {
                format!("The source kept answering {s}. Choose another source, or try this one again in a minute.")
            }
            None => "The source didn't answer.".into(),
        })
    }
}

fn ms(since: Instant) -> u64 {
    since.elapsed().as_millis() as u64
}

fn is_this_machine(url: &Url) -> bool {
    url.host_str().is_some_and(|h| h == "127.0.0.1" || h == "localhost" || h == "[::1]")
}

/// What the loading screen may show of a link: its host, and never anything
/// that points at the user's own network.
pub fn host_label(url: &Url) -> String {
    let Some(host) = url.host_str() else { return "unknown host".into() };
    if is_this_machine(url) {
        return "this computer".into();
    }
    let ip = host.trim_matches(['[', ']']).parse::<IpAddr>().ok();
    if ip.is_some_and(|ip| match ip {
        IpAddr::V4(v4) => v4.is_private() || v4.is_link_local() || v4.is_loopback(),
        IpAddr::V6(v6) => {
            v6.is_loopback() || (v6.segments()[0] & 0xfe00) == 0xfc00 || (v6.segments()[0] & 0xffc0) == 0xfe80
        }
    }) {
        return "a device on your network".into();
    }
    match url.port() {
        Some(p) => format!("{host}:{p}"),
        None => host.to_owned(),
    }
}

/// A transport error in a few words, without the URL reqwest puts in its message.
fn describe(e: &reqwest::Error) -> String {
    let kind = if e.is_timeout() {
        "timed out"
    } else if e.is_connect() {
        "couldn't connect"
    } else {
        "request failed"
    };
    // The innermost cause says what actually happened ("Connection refused",
    // "failed to lookup address information", "invalid peer certificate").
    let mut inner = None;
    let mut cause = std::error::Error::source(e);
    while let Some(c) = cause {
        inner = Some(c);
        cause = c.source();
    }
    match inner.map(|c| c.to_string()).filter(|d| !d.contains("://")) {
        Some(detail) => format!("{kind}: {detail}"),
        None => kind.to_owned(),
    }
}

fn content_type(res: &reqwest::Response) -> Option<String> {
    let t = res.headers().get(header::CONTENT_TYPE)?.to_str().ok()?;
    Some(t.split(';').next()?.trim().to_ascii_lowercase()).filter(|t| !t.is_empty())
}

/// A small video where a whole episode or film should be.
fn is_placeholder(res: &reqwest::Response) -> bool {
    let video = content_type(res).is_some_and(|t| t.starts_with("video/"));
    video && total_size(res).is_some_and(|n| n < PLACEHOLDER_MAX_BYTES)
}

/// The file's full size: `Content-Range: bytes 0-1023/136909`, or the length of a whole-file answer.
fn total_size(res: &reqwest::Response) -> Option<u64> {
    if res.status() == StatusCode::PARTIAL_CONTENT {
        let range = res.headers().get(header::CONTENT_RANGE)?.to_str().ok()?;
        return content_range(range)?.1;
    }
    if !res.status().is_success() {
        return None;
    }
    res.content_length()
}

/// A `Content-Range` header (`bytes 100-199/1000`): the first byte sent, and
/// the whole file's size when the server knows it (`/*` when it doesn't).
pub fn content_range(value: &str) -> Option<(u64, Option<u64>)> {
    let (span, total) = value.trim().strip_prefix("bytes")?.trim().split_once('/')?;
    let (start, end) = span.split_once('-')?;
    let start = start.trim().parse().ok()?;
    end.trim().parse::<u64>().ok().filter(|end| *end >= start)?;
    Some((start, total.trim().parse().ok()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn content_range_reads_start_and_total() {
        assert_eq!(content_range("bytes 0-1023/136909"), Some((0, Some(136909))));
        assert_eq!(content_range(" bytes 500-999/*"), Some((500, None)));
        assert_eq!(content_range("bytes */136909"), None);
        assert_eq!(content_range("bytes 9-3/10"), None);
        assert_eq!(content_range("items 0-1/2"), None);
    }

    /// Runs a test's future. Not `#[tokio::test]`, so the crate's tokio needs no
    /// `macros` feature: one proc macro fewer to build and load.
    fn block<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(f)
    }

    /// A server on 127.0.0.1 answering each path with `respond(path, hit)`, `hit` counting from 0.
    async fn serve(respond: impl Fn(&str, usize) -> String + Send + Sync + 'static) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let hits = Arc::new(AtomicUsize::new(0));
        let respond = Arc::new(respond);
        tokio::spawn(async move {
            loop {
                let (mut sock, _) = listener.accept().await.unwrap();
                let respond = respond.clone();
                let hits = hits.clone();
                tokio::spawn(async move {
                    let mut buf = vec![0u8; 4096];
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    let head = String::from_utf8_lossy(&buf[..n]);
                    let path = head.split_whitespace().nth(1).unwrap_or("/").to_owned();
                    let hit = if path.starts_with("/flaky") { hits.fetch_add(1, Ordering::SeqCst) } else { 0 };
                    let _ = sock.write_all(respond(&path, hit).as_bytes()).await;
                    let _ = sock.shutdown().await;
                });
            }
        });
        base
    }

    fn answer(status: &str, headers: &[(&str, &str)]) -> String {
        let mut s = format!("HTTP/1.1 {status}\r\nConnection: close\r\n");
        for (k, v) in headers {
            s += &format!("{k}: {v}\r\n");
        }
        s + "\r\n"
    }

    fn quick() -> Probe {
        Probe { retry_after: vec![Duration::from_millis(5); 3], ..Probe::default() }
    }

    async fn run(url: &str) -> (Result<String, String>, Vec<ProbeEvent>) {
        let mut events = vec![];
        let r = quick().check(Url::parse(url).unwrap(), &mut |e| events.push(e)).await;
        (r, events)
    }

    fn server(base: &str) -> &str {
        base.trim_start_matches("http://")
    }

    #[test]
    fn sends_the_addons_headers_on_every_hop() {
        block(async {
            // 403 unless the request carries the Referer; the first hop redirects.
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let base = format!("http://{}", listener.local_addr().unwrap());
            tokio::spawn(async move {
                loop {
                    let (mut sock, _) = listener.accept().await.unwrap();
                    let mut buf = vec![0u8; 4096];
                    let n = sock.read(&mut buf).await.unwrap_or(0);
                    let head = String::from_utf8_lossy(&buf[..n]).to_ascii_lowercase();
                    let reply = if !head.contains("\r\nreferer: https://site.example/\r\n") {
                        answer("403 Forbidden", &[])
                    } else if head.starts_with("get /start") {
                        answer("302 Found", &[("Location", "/file.mkv")])
                    } else {
                        answer(
                            "206 Partial Content",
                            &[("Content-Range", "bytes 0-1023/900000000"), ("Content-Length", "0")],
                        )
                    };
                    let _ = sock.write_all(reply.as_bytes()).await;
                    let _ = sock.shutdown().await;
                }
            });
            let url = format!("{base}/start");
            let (without, _) = run(&url).await;
            assert!(without.is_err());
            let probe = Probe { headers: vec![("Referer".into(), "https://site.example/".into())], ..quick() };
            let with = probe.check(Url::parse(&url).unwrap(), &mut |_| {}).await;
            assert_eq!(with.unwrap(), format!("{base}/file.mkv"));
        })
    }

    #[test]
    fn follows_redirects_and_reports_each_hop() {
        block(async {
            let base = serve(|path, _| match path {
                "/start/secret-token/file.mkv" => answer("302 Found", &[("Location", "/cdn/file.mkv?sig=abc")]),
                _ => answer(
                    "206 Partial Content",
                    &[
                        ("Content-Type", "video/x-matroska; charset=binary"),
                        ("Content-Range", "bytes 0-1023/4000000000"),
                    ],
                ),
            })
            .await;
            let (r, events) = run(&format!("{base}/start/secret-token/file.mkv")).await;
            assert_eq!(r.unwrap(), format!("{base}/cdn/file.mkv?sig=abc"));
            // Tests serve from this machine, so hosts show as "this computer"; never a path.
            let text = format!("{events:?}");
            assert!(
                !text.contains("secret-token") && !text.contains("sig=") && !text.contains(server(&base)),
                "{text}"
            );
            assert!(matches!(events[0], ProbeEvent::Request { attempt: 1, .. }));
            assert!(matches!(events[1], ProbeEvent::Redirect { status: 302, .. }));
            match &events[2] {
                ProbeEvent::Response { status, content_type, size, .. } => {
                    assert_eq!(*status, 206);
                    assert_eq!(content_type.as_deref(), Some("video/x-matroska"));
                    assert_eq!(*size, Some(4_000_000_000));
                }
                e => panic!("{e:?}"),
            }
        })
    }

    #[test]
    fn retries_a_link_that_is_not_ready_yet() {
        block(async {
            let base = serve(|_, hit| {
                if hit < 2 {
                    answer("400 Bad Request", &[])
                } else {
                    answer("200 OK", &[("Content-Type", "video/mp4")])
                }
            })
            .await;
            let (r, events) = run(&format!("{base}/flaky")).await;
            // A 200 with no size isn't a placeholder: plays.
            assert!(r.is_ok(), "{r:?}");
            let retries = events.iter().filter(|e| matches!(e, ProbeEvent::Retry { .. })).count();
            assert_eq!(retries, 2);
            assert!(events.contains(&ProbeEvent::Request { host: "this computer".into(), attempt: 3 }));
        })
    }

    #[test]
    fn gives_up_at_once_on_not_found() {
        block(async {
            let base = serve(|_, _| answer("404 Not Found", &[])).await;
            let (r, events) = run(&format!("{base}/gone")).await;
            assert_eq!(r.unwrap_err(), "The source answered 404 Not Found. Choose another source.");
            assert!(!events.iter().any(|e| matches!(e, ProbeEvent::Retry { .. })));
            assert!(
                matches!(&events[1], ProbeEvent::Response { status: 404, reason: Some(r), .. } if r == "Not Found")
            );
        })
    }

    #[test]
    fn keeps_trying_then_says_so() {
        block(async {
            let base = serve(|_, _| answer("503 Service Unavailable", &[])).await;
            let (r, events) = run(&format!("{base}/busy")).await;
            assert!(r.unwrap_err().starts_with("The source kept answering 503 Service Unavailable"));
            assert_eq!(events.iter().filter(|e| matches!(e, ProbeEvent::Request { .. })).count(), 4);
        })
    }

    #[test]
    fn a_slow_busy_server_gives_up_at_the_deadline_and_lets_the_player_try() {
        block(async {
            // A slow "503" every time: without the deadline, 4 tries of up to `timeout` each.
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let base = format!("http://{}", listener.local_addr().unwrap());
            tokio::spawn(async move {
                loop {
                    let (mut sock, _) = listener.accept().await.unwrap();
                    tokio::spawn(async move {
                        let mut buf = vec![0u8; 4096];
                        let _ = sock.read(&mut buf).await;
                        tokio::time::sleep(Duration::from_millis(150)).await;
                        let _ = sock.write_all(answer("503 Service Unavailable", &[]).as_bytes()).await;
                        let _ = sock.shutdown().await;
                    });
                }
            });
            let probe = Probe { deadline: Duration::from_millis(400), timeout: Duration::from_secs(5), ..quick() };
            let url = format!("{base}/busy");
            let started = Instant::now();
            let mut events = vec![];
            let r = probe.check(Url::parse(&url).unwrap(), &mut |e| events.push(e)).await;
            assert!(started.elapsed() < Duration::from_millis(1000), "{:?}", started.elapsed());
            // Ran out of time mid-request: the player gets the link and reports its own error.
            assert_eq!(r.unwrap(), url);
            assert!(events.iter().any(|e| matches!(e, ProbeEvent::Unreachable { .. })), "{events:?}");
        })
    }

    #[test]
    fn spots_a_placeholder_clip() {
        block(async {
            let base = serve(|_, _| {
                answer(
                    "206 Partial Content",
                    &[("Content-Type", "video/mp4"), ("Content-Range", "bytes 0-1023/136909")],
                )
            })
            .await;
            let (r, _) = run(&format!("{base}/clip")).await;
            assert!(r.unwrap_err().contains("placeholder"));
        })
    }

    #[test]
    fn readiness_ready_placeholder_error_page_and_silence() {
        block(async {
            let base = serve(|path, _| match path {
                "/film.mkv" => answer(
                    "206 Partial Content",
                    &[("Content-Type", "video/x-matroska"), ("Content-Range", "bytes 0-1023/4000000000")],
                ),
                "/start" => answer("302 Found", &[("Location", "/film.mkv")]),
                "/clip" => answer(
                    "206 Partial Content",
                    &[("Content-Type", "video/mp4"), ("Content-Range", "bytes 0-1023/136909")],
                ),
                "/page" => answer("200 OK", &[("Content-Type", "text/html; charset=utf-8"), ("Content-Length", "0")]),
                // Stream manifests are text, XML included, and play.
                "/live.m3u8" => {
                    answer("200 OK", &[("Content-Type", "application/vnd.apple.mpegurl"), ("Content-Length", "0")])
                }
                "/film.mpd" => answer("200 OK", &[("Content-Type", "application/dash+xml"), ("Content-Length", "0")]),
                "/busy" => answer("503 Service Unavailable", &[]),
                _ => answer("404 Not Found", &[]),
            })
            .await;
            let check = |path: &str| {
                let url = format!("{base}{path}");
                async move { Probe { retry_after: vec![], ..Probe::default() }.readiness(&url).await }
            };
            assert!(matches!(check("/start").await, Readiness::Ready { .. }));
            assert_eq!(check("/clip").await, Readiness::NotReady { reason: "Not ready at the source".into() });
            assert_eq!(check("/gone").await, Readiness::NotReady { reason: "The link answered 404".into() });
            assert_eq!(check("/busy").await, Readiness::NotReady { reason: "The link answered 503".into() });
            assert!(matches!(check("/live.m3u8").await, Readiness::Ready { .. }));
            assert!(matches!(check("/film.mpd").await, Readiness::Ready { .. }));
            assert_eq!(
                check("/page").await,
                Readiness::NotReady { reason: "Answered with a page, not a video".into() }
            );
            assert_eq!(
                Probe::default().readiness("not a link").await,
                Readiness::Unchecked,
                "not a link: nothing to check"
            );
        })
    }

    #[test]
    fn readiness_of_a_link_that_doesnt_answer_in_time() {
        block(async {
            // Accepts and never answers.
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let url = format!("http://{}/slow", listener.local_addr().unwrap());
            tokio::spawn(async move {
                let mut held = vec![];
                loop {
                    let (sock, _) = listener.accept().await.unwrap();
                    held.push(sock);
                }
            });
            let short = Duration::from_millis(200);
            let probe =
                Probe { retry_after: vec![], connect_timeout: short, timeout: short, deadline: short, headers: vec![] };
            // Slow, not dead: a server that opens the file on demand can take this long for its first byte.
            assert!(matches!(probe.readiness(&url).await, Readiness::Slow { .. }));
        })
    }

    #[test]
    fn readiness_of_a_link_nothing_answers_at() {
        block(async {
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}/x", listener.local_addr().unwrap());
            drop(listener);
            assert_eq!(Probe::default().readiness(&url).await, Readiness::NotReady { reason: "Didn't answer".into() });
        })
    }

    /// A file server that wants Basic auth (`user:secret`), as WebDAV servers do: 401 with a
    /// challenge without it, the file's first bytes with it. `/start` is the add-on's link,
    /// redirecting to `to(base)`.
    async fn dav(to: impl Fn(&str) -> String + Send + Sync + 'static) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let location = to(&base);
        tokio::spawn(async move {
            loop {
                let (mut sock, _) = listener.accept().await.unwrap();
                let mut buf = vec![0u8; 4096];
                let n = sock.read(&mut buf).await.unwrap_or(0);
                let head = String::from_utf8_lossy(&buf[..n]).to_ascii_lowercase();
                // base64("user:secret")
                let reply = if head.starts_with("get /start") {
                    answer("302 Found", &[("Location", location.as_str())])
                } else if !head.contains("\r\nauthorization: basic dxnlcjpzzwnyzxq=\r\n") {
                    answer("401 Unauthorized", &[("WWW-Authenticate", "Basic realm=\"files\"")])
                } else {
                    answer(
                        "206 Partial Content",
                        &[("Content-Type", "video/x-matroska"), ("Content-Range", "bytes 0-1023/2000000000")],
                    )
                };
                let _ = sock.write_all(reply.as_bytes()).await;
                let _ = sock.shutdown().await;
            }
        });
        base
    }

    #[test]
    fn credentials_in_the_redirect_reach_the_file_server() {
        block(async {
            let base = dav(|base| base.replace("http://", "http://user:secret@") + "/dav/film.mkv").await;
            let (r, events) = run(&format!("{base}/start")).await;
            // The player gets the link with its credentials: mpv answers the server's challenge with them.
            assert_eq!(r.unwrap(), base.replace("http://", "http://user:secret@") + "/dav/film.mkv");
            assert!(matches!(events.last(), Some(ProbeEvent::Response { status: 206, .. })), "{events:?}");
            let text = format!("{events:?}");
            assert!(!text.contains("secret") && !text.contains("user"), "{text}");
        })
    }

    #[test]
    fn credentials_in_the_link_itself_stay_on_a_relative_redirect() {
        block(async {
            let base = dav(|_| "/dav/film.mkv".into()).await;
            let start = base.replace("http://", "http://user:secret@");
            let (r, _) = run(&format!("{start}/start")).await;
            assert_eq!(r.unwrap(), format!("{start}/dav/film.mkv"));
        })
    }

    #[test]
    fn a_file_server_without_the_credentials_is_refused_at_once() {
        block(async {
            let base = dav(|base| format!("{base}/dav/film.mkv")).await;
            let (r, events) = run(&format!("{base}/start")).await;
            assert_eq!(r.unwrap_err(), "The source answered 401 Unauthorized. Choose another source.");
            assert!(!events.iter().any(|e| matches!(e, ProbeEvent::Retry { .. })));
        })
    }

    #[test]
    fn a_slow_first_byte_still_plays() {
        // A server that opens the file on demand can take ~10 s to answer: well inside the check's limits.
        let p = Probe::default();
        assert!(p.timeout >= Duration::from_secs(15) && p.deadline > p.timeout, "{p:?}");
        block(async {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let base = format!("http://{}", listener.local_addr().unwrap());
            tokio::spawn(async move {
                loop {
                    let (mut sock, _) = listener.accept().await.unwrap();
                    tokio::spawn(async move {
                        let mut buf = vec![0u8; 4096];
                        let _ = sock.read(&mut buf).await;
                        tokio::time::sleep(Duration::from_millis(600)).await;
                        let reply = answer(
                            "206 Partial Content",
                            &[("Content-Type", "video/mp4"), ("Content-Range", "bytes 0-1023/3000000000")],
                        );
                        let _ = sock.write_all(reply.as_bytes()).await;
                        let _ = sock.shutdown().await;
                    });
                }
            });
            // The same proportions as the defaults, scaled down: first byte at 600 ms of a 2 s timeout.
            let probe = Probe { timeout: Duration::from_secs(2), deadline: Duration::from_secs(3), ..quick() };
            let url = format!("{base}/film.mp4");
            let mut events = vec![];
            let r = probe.check(Url::parse(&url).unwrap(), &mut |e| events.push(e)).await;
            assert_eq!(r.unwrap(), url);
            assert_eq!(events.iter().filter(|e| matches!(e, ProbeEvent::Request { .. })).count(), 1, "{events:?}");
            assert!(matches!(events.last(), Some(ProbeEvent::Response { status: 206, ms, .. }) if *ms >= 600));
        })
    }

    #[test]
    fn stops_a_redirect_loop() {
        block(async {
            let base = serve(|_, _| answer("302 Found", &[("Location", "/again")])).await;
            let (r, events) = run(&format!("{base}/again")).await;
            assert!(r.unwrap_err().contains("too many redirects"));
            assert_eq!(events.iter().filter(|e| matches!(e, ProbeEvent::Redirect { .. })).count(), MAX_REDIRECTS);
        })
    }

    #[test]
    fn a_redirect_off_the_web_is_refused() {
        block(async {
            for to in ["file:///etc/hosts", "edl://x", "smb://192.0.2.1/share/film.mkv"] {
                let base = serve(move |_, _| answer("302 Found", &[("Location", to)])).await;
                let (r, _) = run(&format!("{base}/start")).await;
                assert_eq!(
                    r.unwrap_err(),
                    "The source sent the player to a link it doesn't open. Choose another source."
                );
            }
        })
    }

    #[test]
    fn unreachable_is_reported_and_left_to_the_player() {
        block(async {
            // A port nothing listens on.
            let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
            let url = format!("http://{}/x?token=abc", listener.local_addr().unwrap());
            drop(listener);
            let (r, events) = run(&url).await;
            assert_eq!(r.unwrap(), url);
            match &events[1] {
                ProbeEvent::Unreachable { error, .. } => {
                    assert!(error.starts_with("couldn't connect"), "{error}");
                    assert!(!error.contains("token") && !error.contains("127.0.0.1"), "{error}");
                }
                e => panic!("{e:?}"),
            }
        })
    }

    #[test]
    fn a_server_on_this_machine_is_not_checked() {
        block(async {
            let mut events = vec![];
            let r = prepare("http://127.0.0.1:7878/file.mp4", Vec::new(), |e| events.push(e)).await;
            assert_eq!(r.unwrap(), "http://127.0.0.1:7878/file.mp4");
            assert!(matches!(events[..], [ProbeEvent::Skipped { .. }]));
        })
    }

    #[test]
    fn host_labels_hide_private_addresses() {
        let label = |u: &str| host_label(&Url::parse(u).unwrap());
        assert_eq!(label("https://cdn.example.com/a/b?c=d"), "cdn.example.com");
        assert_eq!(label("https://user:pass@cdn.example.com:8443/x"), "cdn.example.com:8443");
        assert_eq!(label("http://192.168.1.20:8096/x"), "a device on your network");
        assert_eq!(label("http://10.0.0.5/x"), "a device on your network");
        assert_eq!(label("http://[fd00::1]/x"), "a device on your network");
        assert_eq!(label("http://localhost:11470/x"), "this computer");
        assert_eq!(label("http://8.8.8.8/x"), "8.8.8.8");
    }

    #[test]
    fn events_serialize_for_the_ui() {
        let e = ProbeEvent::Response {
            host: "h".into(),
            status: 206,
            reason: None,
            content_type: Some("video/mp4".into()),
            size: Some(1),
            ms: 3,
        };
        let json = serde_json::to_value(&e).unwrap();
        assert_eq!(json["kind"], "response");
        assert_eq!(json["contentType"], "video/mp4");
    }
}
