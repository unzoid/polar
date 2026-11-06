//! The engine: one BitTorrent session for the app, playing one stream at a
//! time. The chosen file is fetched in the order it's read (the player's
//! position first) and handed to the player through [`crate::serve`].
//!
//! Everything is kept in one cache folder, emptied when the engine starts.
//! When playback ends the torrent is removed with its files, unless the user
//! chose to keep sharing it; kept ones are removed oldest first whenever a new
//! stream needs the room under the cache limit.

use std::collections::{HashMap, VecDeque};
use std::net::SocketAddr;
use std::num::NonZeroU32;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use bytes::Bytes;
use librqbit::api::TorrentIdOrHash;
use librqbit::dht::Id20;
use librqbit::{
    AddTorrent, AddTorrentOptions, AddTorrentResponse, DhtSessionConfig, ListOnlyResponse, ListenerOptions,
    ManagedTorrent, Session, SessionOptions,
};
use serde::Serialize;

use crate::magnet;
use crate::serve::{Files, OpenFuture, Opened as Served, Server};

/// How long to wait for peers to send the torrent's file list.
const METADATA_TIMEOUT: Duration = Duration::from_secs(60);
/// An open overtaken by a close or another open.
const CLOSED: &str = "Playback closed before the torrent was ready.";
/// File types a player can open, for picking a file when the add-on names none.
const VIDEO_EXTS: &[&str] = &["mkv", "mp4", "m4v", "webm", "avi", "mov", "ts", "m2ts", "wmv", "mpg", "mpeg"];

/// The user's limits (Settings → Sources), sent with every stream.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Limits {
    /// Most bytes the cache may hold; 0 = no limit.
    pub cache_bytes: u64,
    /// Download and upload speed cap in bytes per second; `None` = none.
    pub rate_bps: Option<NonZeroU32>,
    /// Keep sharing a torrent after its playback ends (until the app quits
    /// or the room is needed). Off: it stops and its files are deleted.
    pub keep_sharing: bool,
}

/// A torrent stream as an add-on describes it.
#[derive(Debug, Clone, Default)]
pub struct Request {
    pub info_hash: String,
    pub file_idx: Option<usize>,
    /// The stream's `sources` (`tracker:<url>`, `dht:<hash>`).
    pub sources: Vec<String>,
}

/// A step of opening a stream, for the player's loading screen. Says nothing
/// about what the torrent is (no names, no hash).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Step {
    /// Asking the DHT (and this many trackers) for peers.
    Searching { trackers: usize, dht: bool },
    /// The file list arrived: file `chosen` (1-based) of `files`.
    Metadata { files: usize, chosen: usize, ext: Option<String>, size: u64, ms: u64 },
    /// Every second while it plays.
    Peers { connected: u32, connecting: u32, down_bps: u64, have: u64, size: u64 },
}

pub type OnStep = Arc<dyn Fn(Step) + Send + Sync>;

/// A stream ready to play.
#[derive(Debug, Clone, Serialize)]
pub struct Opened {
    pub url: String,
    pub size: u64,
}

/// Knobs tests turn; the app uses [`Options::default`].
#[doc(hidden)]
#[derive(Debug, Clone)]
pub struct Options {
    pub dht: bool,
    /// Accept incoming connections here. The app doesn't listen (no firewall
    /// prompt); it connects out to the peers it finds.
    pub listen: Option<SocketAddr>,
    pub initial_peers: Vec<SocketAddr>,
    pub metadata_timeout: Duration,
}

impl Default for Options {
    fn default() -> Self {
        Options { dht: true, listen: None, initial_peers: Vec::new(), metadata_timeout: METADATA_TIMEOUT }
    }
}

struct Active {
    torrent: Arc<ManagedTorrent>,
    file: usize,
    size: u64,
    ext: Option<String>,
    /// Ends this stream's stats loop.
    done: Arc<AtomicBool>,
}

#[derive(Default)]
struct State {
    next: u64,
    /// What the player has open, by link id.
    playing: Option<(u64, Active)>,
    /// Kept for sharing after playback, oldest first.
    kept: VecDeque<Active>,
}

#[derive(Default)]
struct Registry(Mutex<HashMap<u64, (Arc<ManagedTorrent>, usize)>>);

impl Files for Registry {
    fn open(&self, id: u64) -> OpenFuture {
        let found = self.0.lock().unwrap_or_else(PoisonError::into_inner).get(&id).cloned();
        Box::pin(async move {
            let (torrent, file) = found?;
            let stream = torrent.stream(file).await.map_err(|e| tracing::warn!("stream failed to open: {e:#}")).ok()?;
            Some(Served { len: stream.len(), body: Box::new(stream) })
        })
    }
}

pub struct Engine {
    session: Arc<Session>,
    server: Server,
    files: Arc<Registry>,
    state: Mutex<State>,
    /// Bumped by every open and close: an open still waiting for peers when
    /// the player closes (or another open starts) sees it and gives up.
    generation: AtomicU64,
    dir: PathBuf,
    options: Options,
}

impl Engine {
    /// Start the engine with its cache in `dir` (emptied first: nothing is
    /// kept from an earlier run).
    pub async fn start(dir: PathBuf) -> Result<Engine, String> {
        Self::start_with(dir, Options::default()).await
    }

    #[doc(hidden)]
    pub async fn start_with(dir: PathBuf, options: Options) -> Result<Engine, String> {
        empty_dir(&dir).map_err(|e| format!("couldn't prepare the cache folder: {e}"))?;
        let session = Session::new_with_opts(
            dir.clone(),
            SessionOptions {
                dht: options.dht.then_some(DhtSessionConfig { bootstrap_addrs: None, port: None, persistence: None }),
                disable_trackers: false,
                fastresume: false,
                persistence: None,
                listen: options.listen.map(|addr| ListenerOptions { listen_addr: addr, ..Default::default() }),
                disable_local_service_discovery: true,
                client_name_and_version: Some(format!("Polarity/{}", env!("CARGO_PKG_VERSION"))),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| format!("couldn't start: {e:#}"))?;
        let files = Arc::new(Registry::default());
        let server = Server::start(files.clone()).await.map_err(|e| format!("couldn't serve the stream: {e}"))?;
        Ok(Engine { session, server, files, state: Mutex::default(), generation: AtomicU64::new(0), dir, options })
    }

    /// Whether `url` is a link this engine handed out.
    pub fn owns(&self, url: &str) -> bool {
        self.server.owns(url)
    }

    #[doc(hidden)]
    pub fn listen_addr(&self) -> Option<SocketAddr> {
        self.session.listen_addr()
    }

    /// Open `request` for playback, replacing whatever was playing. Reports
    /// its steps to `on_step` (also every second afterwards, until closed).
    pub async fn open(&self, request: &Request, limits: Limits, on_step: OnStep) -> Result<Opened, String> {
        let hash = magnet::info_hash(&request.info_hash).ok_or("This source's torrent id isn't valid.")?;
        self.close(limits).await;
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let stale = || self.generation.load(Ordering::SeqCst) != generation;
        self.session.ratelimits.set_download_bps(limits.rate_bps);
        self.session.ratelimits.set_upload_bps(limits.rate_bps);

        let trackers = magnet::trackers(&request.sources);
        let started = Instant::now();
        on_step(Step::Searching { trackers: trackers.len(), dht: self.options.dht });
        let (torrent, file, size, ext) = match self.take_kept(&hash, request.file_idx) {
            Some(kept) => {
                let ext = kept.ext.clone();
                let files = kept.torrent.metadata.load().as_ref().map_or(1, |m| m.file_infos.len());
                on_step(Step::Metadata { files, chosen: kept.file + 1, ext: ext.clone(), size: kept.size, ms: 0 });
                (kept.torrent, kept.file, kept.size, ext)
            }
            None => {
                // The file list first, so only the chosen file is ever fetched.
                let listed = self.list(&hash, &trackers).await?;
                if stale() {
                    return Err(CLOSED.into());
                }
                let files: Vec<(PathBuf, u64)> =
                    listed.info.iter_file_details().map(|f| (f.filename.to_pathbuf(), f.len)).collect();
                let file = match request.file_idx {
                    Some(i) if i < files.len() => i,
                    Some(i) => {
                        return Err(format!(
                            "The add-on asked for file {} but this torrent has {}.",
                            i + 1,
                            files.len()
                        ))
                    }
                    None => pick_file(files.iter().map(|(p, len)| (p.as_path(), *len))),
                };
                let (size, ext) = (files[file].1, extension(&files[file].0));
                on_step(Step::Metadata {
                    files: files.len(),
                    chosen: file + 1,
                    ext: ext.clone(),
                    size,
                    ms: started.elapsed().as_millis() as u64,
                });
                if limits.cache_bytes > 0 && size > limits.cache_bytes {
                    return Err(format!(
                        "This file ({}) is larger than the torrent cache limit ({}) in Settings → Sources.",
                        gb(size),
                        gb(limits.cache_bytes)
                    ));
                }
                self.make_room(size, limits.cache_bytes).await;
                let torrent = self.add(&hash, listed.torrent_bytes, file, listed.seen_peers).await?;
                (torrent, file, size, ext)
            }
        };

        if stale() {
            self.remove(&torrent).await;
            return Err(CLOSED.into());
        }
        let done = Arc::new(AtomicBool::new(false));
        let id = {
            let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
            state.next += 1;
            let id = state.next;
            state.playing =
                Some((id, Active { torrent: torrent.clone(), file, size, ext: ext.clone(), done: done.clone() }));
            id
        };
        self.files.0.lock().unwrap_or_else(PoisonError::into_inner).insert(id, (torrent.clone(), file));
        tokio::spawn(report(torrent, file, size, done, on_step));
        Ok(Opened { url: self.server.url(id, ext.as_deref()), size })
    }

    /// End playback: the torrent stops and its files go, unless
    /// `limits.keep_sharing`. Nothing happens when nothing plays.
    pub async fn close(&self, limits: Limits) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        let Some((id, active)) = self.state.lock().unwrap_or_else(PoisonError::into_inner).playing.take() else {
            return;
        };
        active.done.store(true, Ordering::SeqCst);
        self.files.0.lock().unwrap_or_else(PoisonError::into_inner).remove(&id);
        if limits.keep_sharing {
            self.state.lock().unwrap_or_else(PoisonError::into_inner).kept.push_back(active);
        } else {
            self.remove(&active.torrent).await;
        }
    }

    /// Stop everything and empty the cache (app exit).
    pub async fn shutdown(&self) {
        let (playing, kept) = {
            let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
            (state.playing.take(), std::mem::take(&mut state.kept))
        };
        for active in playing.map(|(_, a)| a).into_iter().chain(kept) {
            active.done.store(true, Ordering::SeqCst);
            self.remove(&active.torrent).await;
        }
        self.session.stop().await;
        let _ = empty_dir(&self.dir);
    }

    /// Ask peers for the torrent's file list (and who has it).
    async fn list(&self, hash: &str, trackers: &[String]) -> Result<ListOnlyResponse, String> {
        let options = AddTorrentOptions {
            list_only: true,
            initial_peers: (!self.options.initial_peers.is_empty()).then(|| self.options.initial_peers.clone()),
            ..Default::default()
        };
        let timeout = self.options.metadata_timeout;
        let listed = tokio::time::timeout(
            timeout,
            self.session.add_torrent(AddTorrent::from_url(magnet::magnet(hash, trackers)), Some(options)),
        )
        .await
        .map_err(|_| format!("No peers sent this torrent's file list within {} s.", timeout.as_secs()))?
        .map_err(|e| format!("The torrent couldn't be opened: {e:#}"))?;
        match listed {
            AddTorrentResponse::ListOnly(l) => Ok(l),
            _ => Err("The torrent couldn't be opened.".into()),
        }
    }

    /// Start fetching `file` of the listed torrent, from the peers that sent the list (and any others found).
    async fn add(
        &self,
        hash: &str,
        torrent: Bytes,
        file: usize,
        peers: Vec<SocketAddr>,
    ) -> Result<Arc<ManagedTorrent>, String> {
        let peers: Vec<SocketAddr> = self.options.initial_peers.iter().copied().chain(peers).collect();
        let options = AddTorrentOptions {
            only_files: Some(vec![file]),
            overwrite: true,
            sub_folder: Some(hash.to_owned()),
            initial_peers: (!peers.is_empty()).then_some(peers),
            ..Default::default()
        };
        let added = self
            .session
            .add_torrent(AddTorrent::from_bytes(torrent), Some(options))
            .await
            .map_err(|e| format!("The torrent couldn't be opened: {e:#}"))?;
        match added {
            AddTorrentResponse::Added(_, t) | AddTorrentResponse::AlreadyManaged(_, t) => Ok(t),
            AddTorrentResponse::ListOnly(_) => Err("The torrent couldn't be opened.".into()),
        }
    }

    /// A torrent kept for sharing, taken back to play the same file again.
    fn take_kept(&self, hash: &str, file: Option<usize>) -> Option<Active> {
        let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        let at =
            state.kept.iter().position(|a| hex(&a.torrent.info_hash()) == hash && file.is_none_or(|f| f == a.file))?;
        state.kept.remove(at)
    }

    /// Drop kept torrents, oldest first, until `incoming` more bytes fit under `cap`.
    async fn make_room(&self, incoming: u64, cap: u64) {
        if cap == 0 {
            return;
        }
        loop {
            let oldest = {
                let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
                let used: u64 = state.kept.iter().map(|a| a.size).sum();
                if used + incoming <= cap {
                    return;
                }
                state.kept.pop_front()
            };
            match oldest {
                Some(active) => self.remove(&active.torrent).await,
                None => return,
            }
        }
    }

    async fn remove(&self, torrent: &ManagedTorrent) {
        let hash = hex(&torrent.info_hash());
        if let Err(e) = self.session.delete(TorrentIdOrHash::Id(torrent.id()), true).await {
            tracing::warn!("couldn't remove a torrent: {e:#}");
        }
        let _ = std::fs::remove_dir_all(self.dir.join(hash));
    }
}

/// Every second until `done`: peers and progress of the playing file.
async fn report(torrent: Arc<ManagedTorrent>, file: usize, size: u64, done: Arc<AtomicBool>, on_step: OnStep) {
    let mut tick = tokio::time::interval(Duration::from_secs(1));
    loop {
        tick.tick().await;
        if done.load(Ordering::SeqCst) {
            return;
        }
        let stats = torrent.stats();
        let have = stats.file_progress.get(file).copied().unwrap_or(0);
        let (connected, connecting, down_bps) = stats.live.as_ref().map_or((0, 0, 0), |l| {
            let p = &l.snapshot.peer_stats;
            (p.live, p.connecting, (l.download_speed.mbps * 1024.0 * 1024.0) as u64)
        });
        on_step(Step::Peers { connected, connecting, down_bps, have, size });
    }
}

/// The file to play when the add-on names none: the largest video, else the largest file.
fn pick_file<'a>(files: impl Iterator<Item = (&'a Path, u64)>) -> usize {
    let files: Vec<_> = files.collect();
    let largest = |video: bool| {
        files
            .iter()
            .enumerate()
            .filter(|(_, (p, _))| !video || extension(p).is_some_and(|e| VIDEO_EXTS.contains(&e.as_str())))
            .max_by_key(|(_, (_, len))| *len)
            .map(|(i, _)| i)
    };
    largest(true).or_else(|| largest(false)).unwrap_or(0)
}

fn extension(path: &Path) -> Option<String> {
    path.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase)
}

fn hex(id: &Id20) -> String {
    id.0.iter().map(|b| format!("{b:02x}")).collect()
}

fn gb(bytes: u64) -> String {
    format!("{:.1} GB", bytes as f64 / 1e9)
}

fn empty_dir(dir: &Path) -> std::io::Result<()> {
    match std::fs::remove_dir_all(dir) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => return Err(e),
        _ => {}
    }
    std::fs::create_dir_all(dir)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_the_largest_video() {
        let files = [("a/sample.mkv", 10), ("a/extras.txt", 900), ("a/main.mp4", 500), ("a/other.MKV", 400)];
        assert_eq!(pick_file(files.iter().map(|(p, l)| (Path::new(*p), *l))), 2);
        let none = [("notes.txt", 5), ("big.bin", 50)];
        assert_eq!(pick_file(none.iter().map(|(p, l)| (Path::new(*p), *l))), 1);
    }
}
