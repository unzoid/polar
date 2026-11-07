//! A loopback HTTP server that hands the player the file being fetched, with
//! byte ranges so it can seek. Only this machine can reach it (127.0.0.1),
//! and only with the random token in the link.
//!
//! Each connection answers one request and closes; players open a new one for
//! every seek anyway.

use std::future::Future;
use std::io;
use std::net::{Ipv4Addr, SocketAddr};
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use tokio::io::{AsyncRead, AsyncReadExt, AsyncSeek, AsyncSeekExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// A readable, seekable file body.
pub trait Body: AsyncRead + AsyncSeek + Send + Unpin {}
impl<T: AsyncRead + AsyncSeek + Send + Unpin> Body for T {}

/// One file opened for a request.
pub struct Opened {
    pub body: Box<dyn Body>,
    pub len: u64,
}

pub type OpenFuture = Pin<Box<dyn Future<Output = Option<Opened>> + Send>>;

/// What the server serves: file `id`, or `None` once it's gone.
pub trait Files: Send + Sync + 'static {
    fn open(&self, id: u64) -> OpenFuture;
}

/// The longest request head read; players send a few hundred bytes.
const MAX_HEAD: usize = 8 * 1024;
const HEAD_TIMEOUT: Duration = Duration::from_secs(10);
/// Connections answered at once; a player uses one or two. Past it a new one is closed unanswered.
const MAX_CONNECTIONS: usize = 32;

pub struct Server {
    addr: SocketAddr,
    token: String,
}

impl Server {
    /// Listen on a free loopback port and serve `files` until the runtime ends.
    pub async fn start(files: Arc<dyn Files>) -> io::Result<Server> {
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).await?;
        let addr = listener.local_addr()?;
        let token = token()?;
        let prefix = format!("/{token}/");
        let open = Arc::new(tokio::sync::Semaphore::new(MAX_CONNECTIONS));
        tokio::spawn(async move {
            loop {
                let socket = match listener.accept().await {
                    Ok((socket, _)) => socket,
                    // Out of file handles, say: wait a moment rather than spin.
                    Err(_) => {
                        tokio::time::sleep(Duration::from_millis(100)).await;
                        continue;
                    }
                };
                let Ok(permit) = open.clone().try_acquire_owned() else { continue };
                let (files, prefix) = (files.clone(), prefix.clone());
                tokio::spawn(async move {
                    if let Err(e) = answer(socket, &*files, &prefix).await {
                        tracing::debug!("stream request ended: {e}");
                    }
                    drop(permit);
                });
            }
        });
        Ok(Server { addr, token })
    }

    /// The link for file `id`. `ext` ("mkv") lets the player guess the format;
    /// the file's own name stays out of the link (and so out of logs).
    pub fn url(&self, id: u64, ext: Option<&str>) -> String {
        let ext = ext.filter(|e| !e.is_empty() && e.len() <= 5 && e.bytes().all(|b| b.is_ascii_alphanumeric()));
        format!("http://{}/{}/{id}/video{}", self.addr, self.token, ext.map(|e| format!(".{e}")).unwrap_or_default())
    }

    /// Whether `url` is one of this server's links.
    pub fn owns(&self, url: &str) -> bool {
        url.starts_with(&format!("http://{}/{}/", self.addr, self.token))
    }
}

fn token() -> io::Result<String> {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).map_err(|e| io::Error::other(e.to_string()))?;
    Ok(bytes.iter().map(|b| format!("{b:02x}")).collect())
}

async fn answer(mut socket: TcpStream, files: &dyn Files, prefix: &str) -> io::Result<()> {
    let head = tokio::time::timeout(HEAD_TIMEOUT, read_head(&mut socket))
        .await
        .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "no request"))??;
    let request = match parse(&head, prefix) {
        Ok(r) => r,
        Err(status) => return reply(&mut socket, status, &[]).await,
    };
    let Some(mut file) = files.open(request.id).await else {
        return reply(&mut socket, 404, &[]).await;
    };
    let Some((start, end)) = span(request.range, file.len) else {
        return reply(&mut socket, 416, &[("Content-Range", format!("bytes */{}", file.len))]).await;
    };
    let len = end - start;
    let mut headers = vec![
        ("Content-Type", mime(&request.ext).to_owned()),
        ("Content-Length", len.to_string()),
        ("Accept-Ranges", "bytes".to_owned()),
    ];
    let status = if request.range.is_some() {
        headers.push(("Content-Range", format!("bytes {start}-{}/{}", end.saturating_sub(1), file.len)));
        206
    } else {
        200
    };
    reply(&mut socket, status, &headers).await?;
    if request.head || len == 0 {
        return Ok(());
    }
    file.body.seek(io::SeekFrom::Start(start)).await?;
    let copied = tokio::io::copy(&mut (&mut file.body).take(len), &mut socket).await?;
    if copied < len {
        return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "file ended early"));
    }
    socket.flush().await
}

async fn read_head(socket: &mut TcpStream) -> io::Result<String> {
    let mut buf = Vec::with_capacity(1024);
    let mut chunk = [0u8; 1024];
    loop {
        let n = socket.read(&mut chunk).await?;
        if n == 0 {
            return Err(io::Error::new(io::ErrorKind::UnexpectedEof, "closed before the request ended"));
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(end) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
            buf.truncate(end);
            return Ok(String::from_utf8_lossy(&buf).into_owned());
        }
        if buf.len() > MAX_HEAD {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "request too long"));
        }
    }
}

#[derive(Debug, PartialEq)]
struct Request {
    id: u64,
    ext: String,
    head: bool,
    range: Option<Range>,
}

#[derive(Debug, PartialEq, Clone, Copy)]
enum Range {
    /// `bytes=a-` or `bytes=a-b` (b inclusive).
    From(u64, Option<u64>),
    /// `bytes=-n`: the last n bytes.
    Last(u64),
}

/// The request line and the Range header; an HTTP status for anything else.
fn parse(head: &str, prefix: &str) -> Result<Request, u16> {
    let mut lines = head.split("\r\n");
    let mut first = lines.next().unwrap_or_default().split(' ');
    let (method, target) = (first.next().unwrap_or_default(), first.next().unwrap_or_default());
    let head = match method {
        "GET" => false,
        "HEAD" => true,
        _ => return Err(405),
    };
    let rest = strip_token(target, prefix).ok_or(404u16)?;
    let (id, name) = rest.split_once('/').ok_or(404u16)?;
    let id = id.parse().map_err(|_| 404u16)?;
    let ext = name.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    let mut range = None;
    for line in lines {
        let Some((name, value)) = line.split_once(':') else { continue };
        if name.trim().eq_ignore_ascii_case("range") {
            range = Some(parse_range(value.trim()).ok_or(416u16)?);
        }
    }
    Ok(Request { id, ext, head, range })
}

/// `target` after `prefix` (the token), compared in full so the time taken doesn't tell how much of
/// a guess was right.
fn strip_token<'a>(target: &'a str, prefix: &str) -> Option<&'a str> {
    let head = target.as_bytes().get(..prefix.len())?;
    let differs = head.iter().zip(prefix.as_bytes()).fold(0u8, |acc, (a, b)| acc | (a ^ b));
    // Equal bytes up to a char boundary: the slice below can't split a character.
    (differs == 0).then(|| &target[prefix.len()..])
}

fn parse_range(value: &str) -> Option<Range> {
    let spec = value.strip_prefix("bytes=")?;
    // One range only; players never ask for several.
    if spec.contains(',') {
        return None;
    }
    let (a, b) = spec.split_once('-')?;
    let (a, b) = (a.trim(), b.trim());
    if a.is_empty() {
        return b.parse().ok().map(Range::Last);
    }
    let start = a.parse().ok()?;
    let end = if b.is_empty() { None } else { Some(b.parse().ok()?) };
    Some(Range::From(start, end))
}

/// `[start, end)` within a file of `len` bytes, or `None` if it can't be served.
fn span(range: Option<Range>, len: u64) -> Option<(u64, u64)> {
    match range {
        None => Some((0, len)),
        Some(Range::From(start, end)) => {
            let end = end.map_or(len, |e| e.saturating_add(1).min(len));
            (start < len && start < end).then_some((start, end))
        }
        Some(Range::Last(n)) => (n > 0 && len > 0).then(|| (len.saturating_sub(n), len)),
    }
}

fn mime(ext: &str) -> &'static str {
    match ext {
        "mkv" => "video/x-matroska",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "ts" | "m2ts" => "video/mp2t",
        "mov" => "video/quicktime",
        _ => "application/octet-stream",
    }
}

async fn reply(socket: &mut TcpStream, status: u16, headers: &[(&str, String)]) -> io::Result<()> {
    let reason = match status {
        200 => "OK",
        206 => "Partial Content",
        404 => "Not Found",
        405 => "Method Not Allowed",
        416 => "Range Not Satisfiable",
        _ => "Error",
    };
    let mut text = format!("HTTP/1.1 {status} {reason}\r\nConnection: close\r\n");
    for (name, value) in headers {
        text.push_str(&format!("{name}: {value}\r\n"));
    }
    if status >= 400 {
        text.push_str("Content-Length: 0\r\n");
    }
    text.push_str("\r\n");
    socket.write_all(text.as_bytes()).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    struct Memory(Vec<u8>);

    impl Files for Memory {
        fn open(&self, id: u64) -> OpenFuture {
            let data = self.0.clone();
            Box::pin(
                async move { (id == 7).then(|| Opened { len: data.len() as u64, body: Box::new(Cursor::new(data)) }) },
            )
        }
    }

    #[test]
    fn parses_requests() {
        let p = "/tok/";
        assert_eq!(
            parse("GET /tok/7/video.MKV HTTP/1.1\r\nHost: x\r\nrange: bytes=10-", p),
            Ok(Request { id: 7, ext: "mkv".into(), head: false, range: Some(Range::From(10, None)) })
        );
        assert_eq!(parse("HEAD /tok/7/video HTTP/1.1", p).map(|r| (r.head, r.ext)), Ok((true, String::new())));
        assert_eq!(parse("GET /other/7/video.mkv HTTP/1.1", p), Err(404));
        assert_eq!(parse("GET /tok/x/video.mkv HTTP/1.1", p), Err(404));
        assert_eq!(parse("POST /tok/7/video.mkv HTTP/1.1", p), Err(405));
        assert_eq!(parse("GET /tok/7/video.mkv HTTP/1.1\r\nRange: bytes=0-1,5-6", p), Err(416));
    }

    #[test]
    fn spans() {
        assert_eq!(span(None, 100), Some((0, 100)));
        assert_eq!(span(Some(Range::From(10, Some(19))), 100), Some((10, 20)));
        assert_eq!(span(Some(Range::From(90, Some(500))), 100), Some((90, 100)));
        assert_eq!(span(Some(Range::From(100, None)), 100), None);
        assert_eq!(span(Some(Range::Last(30)), 100), Some((70, 100)));
        assert_eq!(span(Some(Range::Last(300)), 100), Some((0, 100)));
        assert_eq!(span(Some(Range::From(20, Some(10))), 100), None);
    }

    #[test]
    fn links_carry_no_file_name() {
        let server = Server { addr: "127.0.0.1:5000".parse().unwrap(), token: "abc".into() };
        assert_eq!(server.url(3, Some("mkv")), "http://127.0.0.1:5000/abc/3/video.mkv");
        assert_eq!(server.url(3, Some("../x")), "http://127.0.0.1:5000/abc/3/video");
        assert!(server.owns("http://127.0.0.1:5000/abc/3/video.mkv"));
        assert!(!server.owns("http://127.0.0.1:5000/abd/3/video.mkv"));
    }

    async fn get(server: &Server, path: &str, range: Option<&str>) -> (String, Vec<u8>) {
        let mut socket = TcpStream::connect(server.addr).await.unwrap();
        let range = range.map(|r| format!("Range: {r}\r\n")).unwrap_or_default();
        socket.write_all(format!("GET {path} HTTP/1.1\r\nHost: x\r\n{range}\r\n").as_bytes()).await.unwrap();
        let mut all = Vec::new();
        socket.read_to_end(&mut all).await.unwrap();
        let split = all.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        (String::from_utf8_lossy(&all[..split]).into_owned(), all[split + 4..].to_vec())
    }

    #[tokio::test]
    async fn serves_ranges_over_loopback() {
        let data: Vec<u8> = (0..1000u32).map(|i| (i % 251) as u8).collect();
        let server = Server::start(Arc::new(Memory(data.clone()))).await.unwrap();
        let link = server.url(7, Some("mkv"));
        let path = &link[link.find(&format!("/{}", server.token)).unwrap()..];

        let (head, body) = get(&server, path, None).await;
        assert!(head.starts_with("HTTP/1.1 200"), "{head}");
        assert!(head.contains("Content-Type: video/x-matroska") && head.contains("Content-Length: 1000"));
        assert_eq!(body, data);

        let (head, body) = get(&server, path, Some("bytes=100-199")).await;
        assert!(head.starts_with("HTTP/1.1 206") && head.contains("Content-Range: bytes 100-199/1000"), "{head}");
        assert_eq!(body, &data[100..200]);

        let (head, body) = get(&server, path, Some("bytes=-10")).await;
        assert!(head.contains("Content-Range: bytes 990-999/1000"));
        assert_eq!(body, &data[990..]);

        let (head, _) = get(&server, path, Some("bytes=5000-")).await;
        assert!(head.starts_with("HTTP/1.1 416") && head.contains("bytes */1000"), "{head}");

        let (head, _) = get(&server, &path.replace("/7/", "/8/"), None).await;
        assert!(head.starts_with("HTTP/1.1 404"));
        let (head, _) = get(&server, "/wrong-token/7/video.mkv", None).await;
        assert!(head.starts_with("HTTP/1.1 404"));
    }

    #[tokio::test]
    async fn idle_connections_past_the_limit_are_closed() {
        let server = Server::start(Arc::new(Memory(vec![1; 10]))).await.unwrap();
        let mut held = Vec::new();
        for _ in 0..MAX_CONNECTIONS {
            held.push(TcpStream::connect(server.addr).await.unwrap());
        }
        // Each held connection has been taken in before the next one knocks.
        tokio::time::sleep(Duration::from_millis(100)).await;
        let mut extra = TcpStream::connect(server.addr).await.unwrap();
        let mut buf = [0u8; 16];
        let read = tokio::time::timeout(Duration::from_secs(2), extra.read(&mut buf)).await;
        assert!(matches!(read, Ok(Ok(0)) | Ok(Err(_))), "{read:?}");

        // One lets go: a new request is answered again.
        drop(held.pop());
        tokio::time::sleep(Duration::from_millis(100)).await;
        let link = server.url(7, None);
        let path = &link[link.find(&format!("/{}", server.token)).unwrap()..];
        let (head, body) = get(&server, path, None).await;
        assert!(head.starts_with("HTTP/1.1 200"), "{head}");
        assert_eq!(body, vec![1; 10]);
    }

    #[test]
    fn the_token_is_compared_whole() {
        assert_eq!(strip_token("/abc/7/video", "/abc/"), Some("7/video"));
        assert_eq!(strip_token("/abd/7/video", "/abc/"), None);
        assert_eq!(strip_token("/ab", "/abc/"), None);
        assert_eq!(strip_token("", "/abc/"), None);
    }
}
