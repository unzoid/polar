//! Discord Rich Presence (#31): what plays, on the user's Discord profile, as Settings → Playback
//! has it (by default only that Polarity is in use, #150; the title only when the user picks it). Talks to the Discord app on this machine over its local
//! IPC socket (a named pipe on Windows): a handshake with the app's client id, then `SET_ACTIVITY`.
//! The client id is Polarity's Discord application ([`APP_ID`]); a build can use another with
//! `POLAR_DISCORD_CLIENT_ID`, or none by setting it empty. Without an id, or on a machine where
//! Discord isn't running, nothing is shown. One thread owns the connection, so a
//! slow or missing Discord never holds up the player; it sends the latest activity only, at most
//! once every few seconds (Discord's own limit), and logs no titles.
// The phone apps have no Discord IPC: there the commands do nothing.
#![cfg_attr(any(target_os = "android", target_os = "ios"), allow(dead_code))]

use serde::{Deserialize, Serialize};

/// What the webview asks for; `None` clears it.
#[derive(Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    /// The first line (the title, or "Watching").
    pub details: String,
    /// The second line ("S1 E5 · Episode", "Paused").
    pub state: Option<String>,
    /// Unix milliseconds: when it would have started at this speed, and when it ends ("12:04 left").
    pub start: Option<i64>,
    pub end: Option<i64>,
    /// An https picture (the poster), and its hover text.
    pub image: Option<String>,
    pub image_text: Option<String>,
    /// Up to two link buttons others see on the profile (#153): only to the website's hand-over pages.
    #[serde(default)]
    pub buttons: Vec<Button>,
}

#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
pub struct Button {
    pub label: String,
    pub url: String,
}

/// Where a button may point: the website's pages that hand over to the app, nothing else.
const BUTTON_SITE: &str = "https://getpolar.app/";

/// The buttons Discord takes: two at most, a 1-32 character label, a link to [`BUTTON_SITE`] of
/// 512 characters at most.
fn buttons(all: &[Button]) -> Vec<Button> {
    all.iter()
        .filter(|b| b.url.starts_with(BUTTON_SITE) && b.url.len() <= 512 && b.url.bytes().all(|c| c.is_ascii_graphic()))
        .filter_map(|b| {
            let label: String = b.label.trim().chars().take(32).collect();
            (!label.is_empty()).then(|| Button { label, url: b.url.clone() })
        })
        .take(2)
        .collect()
}

/// Polarity's application in Discord's Developer Portal, named "Polarity", which is what profiles
/// show ("Watching Polarity"). An application id isn't a secret: Discord shows it to anyone who
/// sees the activity.
const APP_ID: &str = "1568225292877701221";

/// The build's Discord application: `POLAR_DISCORD_CLIENT_ID` when the build sets it (empty for
/// none), else [`APP_ID`].
fn client_id() -> Option<&'static str> {
    pick_client_id(option_env!("POLAR_DISCORD_CLIENT_ID"))
}

fn pick_client_id(from_build: Option<&'static str>) -> Option<&'static str> {
    Some(from_build.unwrap_or(APP_ID)).filter(|id| !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit()))
}

/// Discord wants 2-128 characters on each line.
fn line(text: &str) -> Option<String> {
    let t: String = text.trim().chars().take(128).collect();
    match t.chars().count() {
        0 => None,
        1 => Some(format!("{t} ")),
        _ => Some(t),
    }
}

/// The `activity` of a `SET_ACTIVITY` (type 3: "Watching").
fn payload(a: &Activity) -> serde_json::Value {
    #[derive(Serialize)]
    struct Timestamps {
        #[serde(skip_serializing_if = "Option::is_none")]
        start: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        end: Option<i64>,
    }
    let mut out = serde_json::json!({ "type": 3, "details": line(&a.details).unwrap_or_else(|| "Watching".into()) });
    if let Some(state) = a.state.as_deref().and_then(line) {
        out["state"] = state.into();
    }
    if a.start.is_some() || a.end.is_some() {
        out["timestamps"] = serde_json::to_value(Timestamps { start: a.start, end: a.end }).unwrap();
    }
    if let Some(image) = a.image.as_deref().filter(|u| u.starts_with("https://") && u.len() <= 256) {
        let mut assets = serde_json::json!({ "large_image": image });
        if let Some(text) = a.image_text.as_deref().and_then(line) {
            assets["large_text"] = text.into();
        }
        out["assets"] = assets;
    }
    // Discord refuses an activity with both buttons and a join secret: Polarity uses buttons only.
    let buttons = buttons(&a.buttons);
    if !buttons.is_empty() {
        out["buttons"] = serde_json::to_value(buttons).unwrap();
    }
    out
}

/// One IPC frame: opcode, length, JSON (little-endian).
fn frame(op: u32, body: &serde_json::Value) -> Vec<u8> {
    let json = body.to_string().into_bytes();
    let mut out = Vec::with_capacity(8 + json.len());
    out.extend_from_slice(&op.to_le_bytes());
    out.extend_from_slice(&(json.len() as u32).to_le_bytes());
    out.extend_from_slice(&json);
    out
}

#[cfg(not(any(target_os = "android", target_os = "ios")))]
mod ipc {
    use std::io::{Read, Write};
    use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
    use std::sync::OnceLock;
    use std::time::{Duration, Instant};

    use super::{client_id, frame, payload, Activity};

    #[cfg(unix)]
    type Conn = std::os::unix::net::UnixStream;
    #[cfg(windows)]
    type Conn = std::fs::File;

    /// Discord allows about five updates in twenty seconds.
    const MIN_GAP: Duration = Duration::from_secs(4);
    /// After Discord wasn't there, how long before looking again.
    const RETRY: Duration = Duration::from_secs(20);

    #[cfg(unix)]
    fn open() -> Option<Conn> {
        let mut dirs: Vec<std::path::PathBuf> = ["XDG_RUNTIME_DIR", "TMPDIR", "TMP", "TEMP"]
            .iter()
            .filter_map(|k| std::env::var_os(k).map(Into::into))
            .collect();
        dirs.push("/tmp".into());
        // Flatpak and Snap builds of Discord put theirs one level down.
        let dirs: Vec<_> = dirs
            .iter()
            .flat_map(|d| [d.clone(), d.join("app/com.discordapp.Discord"), d.join("snap.discord")])
            .collect();
        for dir in dirs {
            for n in 0..10 {
                if let Ok(c) = Conn::connect(dir.join(format!("discord-ipc-{n}"))) {
                    let _ = c.set_read_timeout(Some(Duration::from_secs(5)));
                    let _ = c.set_write_timeout(Some(Duration::from_secs(5)));
                    return Some(c);
                }
            }
        }
        None
    }

    #[cfg(windows)]
    fn open() -> Option<Conn> {
        (0..10).find_map(|n| {
            std::fs::OpenOptions::new().read(true).write(true).open(format!(r"\\?\pipe\discord-ipc-{n}")).ok()
        })
    }

    /// Reads one frame's body (Discord answers every message; its content isn't needed).
    fn read_frame(c: &mut impl Read) -> std::io::Result<u32> {
        let mut head = [0u8; 8];
        c.read_exact(&mut head)?;
        let op = u32::from_le_bytes(head[..4].try_into().unwrap());
        let len = u32::from_le_bytes(head[4..].try_into().unwrap()) as usize;
        if len > 1 << 20 {
            return Err(std::io::Error::other("frame too large"));
        }
        let mut body = vec![0u8; len];
        c.read_exact(&mut body)?;
        Ok(op)
    }

    /// The handshake on a fresh connection.
    pub(super) fn handshake<C: Read + Write>(mut c: C, id: &str) -> Option<C> {
        c.write_all(&frame(0, &serde_json::json!({ "v": 1, "client_id": id }))).ok()?;
        // 1 = READY; 2 = Discord closed it (a client id it doesn't know).
        (read_frame(&mut c).ok()? == 1).then_some(c)
    }

    fn send(c: &mut (impl Read + Write), activity: Option<&Activity>, nonce: u64) -> std::io::Result<()> {
        let body = serde_json::json!({
            "cmd": "SET_ACTIVITY",
            "args": { "pid": std::process::id(), "activity": activity.map(payload) },
            "nonce": nonce.to_string(),
        });
        c.write_all(&frame(1, &body))?;
        read_frame(c).map(|_| ())
    }

    /// The thread: keeps Discord showing the latest of what `rx` brings; `connect` opens and greets it.
    pub(super) fn run<C: Read + Write>(rx: Receiver<Option<Activity>>, mut connect: impl FnMut() -> Option<C>) {
        let mut conn: Option<C> = None;
        let mut wanted: Option<Activity> = None;
        let mut shown: Option<Option<Activity>> = None;
        let mut last_send: Option<Instant> = None;
        let mut last_try: Option<Instant> = None;
        let mut nonce = 0u64;
        loop {
            // Wait for a change, or for the gap (or the retry) to pass when one is still to send.
            let pending = shown.as_ref() != Some(&wanted);
            let wait = if !pending {
                None
            } else if conn.is_none() {
                Some(last_try.map_or(Duration::ZERO, |t| RETRY.saturating_sub(t.elapsed())))
            } else {
                Some(last_send.map_or(Duration::ZERO, |t| MIN_GAP.saturating_sub(t.elapsed())))
            };
            let got = match wait {
                None => rx.recv().map_err(|_| RecvTimeoutError::Disconnected),
                Some(d) => rx.recv_timeout(d),
            };
            match got {
                Ok(a) => {
                    wanted = a;
                    // Take everything queued: only the latest counts.
                    while let Ok(a) = rx.try_recv() {
                        wanted = a;
                    }
                    continue;
                }
                Err(RecvTimeoutError::Disconnected) => return,
                Err(RecvTimeoutError::Timeout) => {}
            }
            if conn.is_none() {
                // Nothing shown and nothing to show: no need to look for Discord.
                if wanted.is_none() && shown.is_none() {
                    shown = Some(None);
                    continue;
                }
                last_try = Some(Instant::now());
                conn = connect();
                if conn.is_none() {
                    // Discord isn't running: whatever it showed went with it.
                    shown = None;
                    continue;
                }
                tracing::info!("discord: connected");
            }
            nonce += 1;
            last_send = Some(Instant::now());
            match send(conn.as_mut().unwrap(), wanted.as_ref(), nonce) {
                Ok(()) => shown = Some(wanted.clone()),
                Err(_) => {
                    tracing::info!("discord: connection closed");
                    conn = None;
                    shown = None;
                    last_try = Some(Instant::now());
                }
            }
        }
    }

    static TX: OnceLock<Option<std::sync::Mutex<Sender<Option<Activity>>>>> = OnceLock::new();

    pub fn available() -> bool {
        client_id().is_some()
    }

    pub fn set(activity: Option<Activity>) {
        let tx = TX.get_or_init(|| {
            let id = client_id()?;
            let (tx, rx) = mpsc::channel();
            std::thread::Builder::new()
                .name("discord".into())
                .spawn(move || run(rx, || open().and_then(|c| handshake(c, id))))
                .ok()?;
            Some(std::sync::Mutex::new(tx))
        });
        if let Some(tx) = tx {
            let _ = tx.lock().unwrap().send(activity);
        }
    }
}

#[cfg(any(target_os = "android", target_os = "ios"))]
mod ipc {
    pub fn available() -> bool {
        false
    }
    pub fn set(_: Option<super::Activity>) {}
}

/// Whether this build can show Rich Presence (desktop, with a Discord application).
#[tauri::command]
pub fn discord_available() -> bool {
    ipc::available()
}

/// Shows `activity` on the user's Discord profile, or clears it. Never fails: without Discord, nothing happens.
#[tauri::command]
pub fn discord_presence(activity: Option<Activity>) {
    ipc::set(activity);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_build_uses_polaritys_application_unless_it_names_another_or_none() {
        assert_eq!(pick_client_id(None), Some(APP_ID));
        assert_eq!(pick_client_id(Some("123456789012345678")), Some("123456789012345678"));
        assert_eq!(pick_client_id(Some("")), None);
        assert_eq!(pick_client_id(Some("not-an-id")), None);
    }

    fn activity() -> Activity {
        Activity {
            details: "The Lantern Keepers".into(),
            state: Some("S1 E5 · The Long Night".into()),
            start: Some(1_000),
            end: Some(2_000),
            image: Some("https://media.example.com/poster.jpg".into()),
            image_text: Some("The Lantern Keepers".into()),
            buttons: vec![],
        }
    }

    #[test]
    fn payload_is_a_watching_activity() {
        assert_eq!(
            payload(&activity()),
            serde_json::json!({
                "type": 3,
                "details": "The Lantern Keepers",
                "state": "S1 E5 · The Long Night",
                "timestamps": { "start": 1000, "end": 2000 },
                "assets": { "large_image": "https://media.example.com/poster.jpg", "large_text": "The Lantern Keepers" },
            })
        );
    }

    #[test]
    fn payload_keeps_to_discords_limits() {
        let a = Activity {
            details: "x".into(),
            state: Some("  ".into()),
            start: None,
            end: None,
            image: Some("http://media.example.com/poster.jpg".into()),
            image_text: None,
            buttons: vec![],
        };
        assert_eq!(payload(&a), serde_json::json!({ "type": 3, "details": "x " }));
        let long = Activity { details: "y".repeat(300), ..a };
        assert_eq!(payload(&long)["details"].as_str().unwrap().chars().count(), 128);
    }

    #[test]
    fn buttons_only_link_to_the_website_and_keep_to_discords_limits() {
        let b = |label: &str, url: &str| Button { label: label.into(), url: url.into() };
        let a = Activity {
            buttons: vec![
                b("Watch in Polarity", "https://getpolar.app/watch?type=movie&id=tt0000000"),
                b("Elsewhere", "https://media.example.com/film.mkv"),
                b("Look-alike", "https://getpolar.app.example.com/party"),
                b("   ", "https://getpolar.app/party?t=xxx"),
                b(&"J".repeat(40), "https://getpolar.app/party?t=xxx"),
                b("Third", "https://getpolar.app/party?t=yyy"),
            ],
            ..activity()
        };
        assert_eq!(
            payload(&a)["buttons"],
            serde_json::json!([
                { "label": "Watch in Polarity", "url": "https://getpolar.app/watch?type=movie&id=tt0000000" },
                { "label": "J".repeat(32), "url": "https://getpolar.app/party?t=xxx" },
            ])
        );
        assert!(payload(&activity()).get("buttons").is_none());
        let none_left = Activity { buttons: vec![b("Elsewhere", "http://getpolar.app/watch")], ..activity() };
        assert!(payload(&none_left).get("buttons").is_none());
    }

    #[test]
    fn frames_are_opcode_length_json() {
        let f = frame(1, &serde_json::json!({ "a": 1 }));
        assert_eq!(&f[..4], &1u32.to_le_bytes());
        assert_eq!(&f[4..8], &7u32.to_le_bytes());
        assert_eq!(&f[8..], br#"{"a":1}"#);
    }

    /// Against a stand-in for Discord on the other end of a socket pair.
    #[cfg(all(unix, not(any(target_os = "android", target_os = "ios"))))]
    #[test]
    fn sends_the_latest_activity_and_keeps_to_the_rate() {
        use std::io::{Read, Write};
        use std::os::unix::net::UnixStream;
        fn read(c: &mut UnixStream) -> (u32, serde_json::Value) {
            let mut h = [0u8; 8];
            c.read_exact(&mut h).unwrap();
            let mut b = vec![0; u32::from_le_bytes(h[4..].try_into().unwrap()) as usize];
            c.read_exact(&mut b).unwrap();
            (u32::from_le_bytes(h[..4].try_into().unwrap()), serde_json::from_slice(&b).unwrap())
        }
        let (ours, mut discord) = UnixStream::pair().unwrap();
        let mut ours = Some(ours);
        let (tx, rx) = std::sync::mpsc::channel();
        tx.send(Some(Activity { state: Some("Paused".into()), ..activity() })).unwrap();
        tx.send(Some(activity())).unwrap();
        std::thread::spawn(move || ipc::run(rx, || ours.take().and_then(|c| ipc::handshake(c, "123"))));

        let (op, hello) = read(&mut discord);
        assert_eq!((op, hello["client_id"].as_str()), (0, Some("123")));
        discord.write_all(&frame(1, &serde_json::json!({ "evt": "READY" }))).unwrap();
        let (op, msg) = read(&mut discord);
        assert_eq!((op, msg["cmd"].as_str()), (1, Some("SET_ACTIVITY")));
        // Only the latest of the two.
        assert_eq!(msg["args"]["activity"]["state"], "S1 E5 · The Long Night");
        discord.write_all(&frame(1, &serde_json::json!({}))).unwrap();

        let asked = std::time::Instant::now();
        tx.send(None).unwrap();
        let (_, msg) = read(&mut discord);
        assert!(msg["args"]["activity"].is_null());
        assert!(asked.elapsed() >= std::time::Duration::from_secs(3), "Discord's rate limit kept");
    }

    #[test]
    fn webview_shape_parses() {
        let a: Activity =
            serde_json::from_value(serde_json::json!({ "details": "Watching", "state": null, "imageText": "x" }))
                .unwrap();
        assert_eq!(a.image_text.as_deref(), Some("x"));
        assert!(a.start.is_none());
    }
}
