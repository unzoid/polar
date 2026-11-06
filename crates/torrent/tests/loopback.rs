//! The engine end to end over loopback: a second session shares a made-up
//! file, the engine fetches it from that peer alone (no DHT, no trackers) and
//! serves it, seeking included.

use std::net::SocketAddr;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use librqbit::spawn_utils::BlockingSpawner;
use librqbit::{
    create_torrent, AddTorrent, AddTorrentOptions, CreateTorrentOptions, ListenerOptions, Session, SessionOptions,
};
use polar_torrent::{Engine, Limits, Options, Request, Step};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

fn scratch(name: &str) -> std::path::PathBuf {
    let dir = Path::new(env!("CARGO_TARGET_TMPDIR")).join(format!("polar-torrent-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

/// A session sharing `pack/` (a small file and a larger "film"); its address and the torrent's hash.
async fn sharer(root: &Path, film: &[u8]) -> (Arc<Session>, SocketAddr, String) {
    let pack = root.join("pack");
    std::fs::create_dir_all(&pack).unwrap();
    std::fs::write(pack.join("notes.txt"), b"made-up notes").unwrap();
    std::fs::write(pack.join("film.mkv"), film).unwrap();
    let created = create_torrent(
        &pack,
        CreateTorrentOptions { piece_length: Some(16 * 1024), ..Default::default() },
        &BlockingSpawner::new(2),
    )
    .await
    .unwrap();
    let hash = created.info_hash().as_string();
    let bytes = created.as_bytes().unwrap();
    let session = Session::new_with_opts(
        root.join("session"),
        SessionOptions {
            dht: None,
            listen: Some(ListenerOptions { listen_addr: "127.0.0.1:0".parse().unwrap(), ..Default::default() }),
            disable_local_service_discovery: true,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let options = AddTorrentOptions {
        overwrite: true,
        output_folder: Some(pack.to_string_lossy().into_owned()),
        ..Default::default()
    };
    let handle =
        session.add_torrent(AddTorrent::from_bytes(bytes), Some(options)).await.unwrap().into_handle().unwrap();
    // It checks the files it was given; then it has everything to share.
    for _ in 0..100 {
        if handle.stats().finished {
            break;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    assert!(handle.stats().finished);
    let addr = session.listen_addr().unwrap();
    (session, addr, hash)
}

async fn get(url: &str, range: Option<&str>) -> (String, Vec<u8>) {
    let rest = url.strip_prefix("http://").unwrap();
    let (host, path) = rest.split_at(rest.find('/').unwrap());
    let mut socket = TcpStream::connect(host).await.unwrap();
    let range = range.map(|r| format!("Range: {r}\r\n")).unwrap_or_default();
    socket.write_all(format!("GET {path} HTTP/1.1\r\nHost: {host}\r\n{range}\r\n").as_bytes()).await.unwrap();
    let mut all = Vec::new();
    tokio::time::timeout(Duration::from_secs(30), socket.read_to_end(&mut all)).await.unwrap().unwrap();
    let split = all.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
    (String::from_utf8_lossy(&all[..split]).into_owned(), all[split + 4..].to_vec())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn plays_a_file_from_a_peer() {
    let film: Vec<u8> = (0..300_000u32).map(|i| (i.wrapping_mul(2654435761) >> 13) as u8).collect();
    let root = scratch("sharer");
    let (_sharer, peer, hash) = sharer(&root, &film).await;

    let cache = scratch("cache");
    let engine = Engine::start_with(
        cache.clone(),
        Options {
            dht: false,
            initial_peers: vec![peer],
            metadata_timeout: Duration::from_secs(20),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let steps = Arc::new(Mutex::new(Vec::new()));
    let log = steps.clone();
    let request = Request { info_hash: hash.clone(), file_idx: None, sources: vec![] };
    let opened =
        engine.open(&request, Limits::default(), Arc::new(move |s| log.lock().unwrap().push(s))).await.unwrap();

    assert_eq!(opened.size, film.len() as u64);
    assert!(opened.url.starts_with("http://127.0.0.1:") && opened.url.ends_with("/video.mkv"), "{}", opened.url);
    assert!(engine.owns(&opened.url));
    {
        let steps = steps.lock().unwrap();
        assert_eq!(steps[0], Step::Searching { trackers: 0, dht: false });
        assert!(
            matches!(&steps[1], Step::Metadata { files: 2, ext: Some(e), size, .. } if e == "mkv" && *size == film.len() as u64),
            "{:?}",
            steps[1]
        );
    }

    // A seek past the start first, then the whole file.
    let (head, body) = get(&opened.url, Some("bytes=200000-200999")).await;
    assert!(head.starts_with("HTTP/1.1 206"), "{head}");
    assert_eq!(body, &film[200_000..201_000]);
    let (head, body) = get(&opened.url, None).await;
    assert!(head.starts_with("HTTP/1.1 200"), "{head}");
    assert_eq!(body, film);

    // Stats arrive every second while it plays.
    tokio::time::sleep(Duration::from_millis(1500)).await;
    assert!(steps.lock().unwrap().iter().any(|s| matches!(s, Step::Peers { .. })));

    // Closing (not sharing) removes the torrent and its files; the link stops working.
    engine.close(Limits::default()).await;
    let (head, _) = get(&opened.url, None).await;
    assert!(head.starts_with("HTTP/1.1 404"), "{head}");
    assert!(!cache.join(&hash).exists());

    // Over the cache limit: refused before anything is fetched.
    let small = Limits { cache_bytes: 1000, ..Default::default() };
    let err = engine.open(&request, small, Arc::new(|_| {})).await.unwrap_err();
    assert!(err.contains("larger than the torrent cache limit"), "{err}");

    // A file index the torrent doesn't have.
    let wrong = Request { file_idx: Some(5), ..request.clone() };
    let err = engine.open(&wrong, Limits::default(), Arc::new(|_| {})).await.unwrap_err();
    assert!(err.contains("file 6 but this torrent has 2"), "{err}");

    // Kept for sharing: still there after playback, reused by the next open.
    let sharing = Limits { keep_sharing: true, ..Default::default() };
    let first = engine.open(&request, sharing, Arc::new(|_| {})).await.unwrap();
    engine.close(sharing).await;
    assert!(cache.join(&hash).exists());
    let again = engine.open(&request, sharing, Arc::new(|_| {})).await.unwrap();
    assert_ne!(first.url, again.url);
    let (_, body) = get(&again.url, Some("bytes=0-99")).await;
    assert_eq!(body, &film[..100]);

    engine.shutdown().await;
    assert!(std::fs::read_dir(&cache).unwrap().next().is_none());
    let _ = std::fs::remove_dir_all(&cache);
    let _ = std::fs::remove_dir_all(&root);
}

#[tokio::test]
async fn bad_hash_and_no_peers() {
    let dir = scratch("lonely");
    let engine = Engine::start_with(
        dir.clone(),
        Options {
            dht: false,
            initial_peers: vec!["127.0.0.1:9".parse().unwrap()],
            metadata_timeout: Duration::from_secs(1),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let bad = Request { info_hash: "nope".into(), ..Default::default() };
    assert!(engine.open(&bad, Limits::default(), Arc::new(|_| {})).await.unwrap_err().contains("isn't valid"));
    // A peer that never answers (the discard port).
    let lonely = Request { info_hash: "0123456789abcdef0123456789abcdef01234567".into(), ..Default::default() };
    let err = engine.open(&lonely, Limits::default(), Arc::new(|_| {})).await.unwrap_err();
    assert!(err.contains("No peers sent") || err.contains("couldn't be opened"), "{err}");
    engine.shutdown().await;
    let _ = std::fs::remove_dir_all(&dir);
}
