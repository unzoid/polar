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
}

impl Default for Probe {
    fn default() -> Self {
        Self {
            // About 5 s in all.
            retry_after: [600, 1500, 3000].map(Duration::from_millis).to_vec(),
            connect_timeout: Duration::from_secs(8),
            timeout: Duration::from_secs(20),
        }
    }
}

/// Smaller than any real episode; the addons' status clips are ~100 KB.
const PLACEHOLDER_MAX_BYTES: u64 = 10 * 1024 * 1024;
const MAX_REDIRECTS: usize = 10;

/// The URL the player should open, or why this source won't play (in plain words).
pub async fn prepare(url: &str, on: impl FnMut(ProbeEvent)) -> Result<String, String> {
    Probe::default().run(url, on).await
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

        let mut last = None;
        for attempt in 0..=self.retry_after.len() {
            if attempt > 0 {
                let wait = self.retry_after[attempt - 1];
                on(ProbeEvent::Retry { after_ms: wait.as_millis() as u64 });
                tokio::time::sleep(wait).await;
            }
            let mut url = start.clone();
            on(ProbeEvent::Request { host: host_label(&url), attempt: attempt as u32 + 1 });
            let mut hops = 0;
            let (res, took) = loop {
                let sent = Instant::now();
                let res = match http.get(url.clone()).header(header::RANGE, "bytes=0-1023").send().await {
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

    #[test]
    fn content_range_reads_start_and_total() {
        assert_eq!(content_range("bytes 0-1023/136909"), Some((0, Some(136909))));
        assert_eq!(content_range(" bytes 500-999/*"), Some((500, None)));
        assert_eq!(content_range("bytes */136909"), None);
        assert_eq!(content_range("bytes 9-3/10"), None);
        assert_eq!(content_range("items 0-1/2"), None);
    }
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    /// Runs a test's future. Not `#[tokio::test]`: on the dev VM, tokio's `macros`
    /// feature next to thiserror makes rustc lose thiserror (E0463, T-012).
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
    fn stops_a_redirect_loop() {
        block(async {
            let base = serve(|_, _| answer("302 Found", &[("Location", "/again")])).await;
            let (r, events) = run(&format!("{base}/again")).await;
            assert!(r.unwrap_err().contains("too many redirects"));
            assert_eq!(events.iter().filter(|e| matches!(e, ProbeEvent::Redirect { .. })).count(), MAX_REDIRECTS);
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
            let r = prepare("http://127.0.0.1:7878/file.mp4", |e| events.push(e)).await;
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
