//! The JSON field names of the command results and stored types this crate
//! defines, checked against `contract/app.json` (see `polar_addon`'s
//! `contract.rs`, which this follows). A child of `commands`, so it can build
//! the result types whose fields are private there. On a mismatch the test
//! prints the file as it now should read.

use std::collections::HashMap;

use polar_addon::Manifest;
use polar_library::Changes;
use serde::Serialize;
use serde_json::{json, Map, Value};

use super::{CacheInfo, CmdError, Playable, SearchResults, SettingsView, StreamsResult, SubtitleOption};
use crate::downloads::{Download, DownloadState};
use crate::store::{InstalledAddon, Settings, SubtitleStyle};
use crate::sync::LocalChanges;

fn keys<T: Serialize>(value: &T) -> Value {
    let Value::Object(map) = serde_json::to_value(value).unwrap() else { panic!("not an object") };
    let mut keys: Vec<_> = map.keys().cloned().collect();
    keys.sort();
    json!(keys)
}

/// One line per type.
fn render(types: &Value) -> String {
    let lines: Vec<_> = types.as_object().unwrap().iter().map(|(name, keys)| format!("  {name:?}: {keys}")).collect();
    format!("{{\n{}\n}}\n", lines.join(",\n"))
}

fn s(text: &str) -> Option<String> {
    Some(text.into())
}

#[test]
fn field_names_match_contract() {
    let mut types = Map::new();
    let mut add = |name: &str, keys: Value| types.insert(name.into(), keys);
    // What settings_get/settings_set/settings_reset return: the stored settings and the metadata source.
    add("Settings", keys(&SettingsView { settings: Settings::default(), metadata_source: "cinemeta" }));
    add("SubtitleStyle", keys(&SubtitleStyle::default()));
    let manifest = Manifest {
        id: "a".into(),
        version: "1".into(),
        name: "A".into(),
        description: None,
        logo: None,
        resources: vec![],
        types: vec![],
        catalogs: vec![],
        id_prefixes: None,
        behavior_hints: None,
    };
    add("InstalledAddon", keys(&InstalledAddon { manifest_url: "https://a.io/manifest.json".into(), manifest }));
    add(
        "Download",
        keys(&Download {
            id: "tt1:1:1".into(),
            meta_id: "tt1".into(),
            ty: "series".into(),
            name: "Show".into(),
            poster: s("p"),
            background: s("b"),
            logo: s("l"),
            season: Some(1),
            episode: Some(1),
            episode_title: s("Pilot"),
            thumbnail: s("t"),
            quality: "1080p".into(),
            url: "https://a.io/v.mkv".into(),
            file: "v.mkv".into(),
            received: 1,
            total: Some(2),
            state: DownloadState::Downloading,
            error: s("e"),
            added_at: 1,
            headers: HashMap::from([("Referer".into(), "https://a.io".into())]),
        }),
    );
    add("LocalChanges", keys(&LocalChanges { changes: Changes::default(), pulled_at: s("2026-01-01") }));
    add("StreamsResult", keys(&StreamsResult { streams: vec![], failed: vec![], hidden: 0 }));
    add("Playable.url", keys(&Playable::Url { url: "https://a.io".into() }));
    add("Playable.external", keys(&Playable::External { url: "https://a.io".into() }));
    add("Playable.unsupported", keys(&Playable::Unsupported { reason: "r".into() }));
    add(
        "SubtitleOption",
        keys(&SubtitleOption {
            id: "1".into(),
            url: "https://a.io/s.srt".into(),
            lang: "en".into(),
            addon: "A".into(),
        }),
    );
    add("SearchResults", keys(&SearchResults { movies: vec![], series: vec![] }));
    add("CacheInfo", keys(&CacheInfo { path: "p".into(), bytes: 1 }));
    let cue = crate::seekr::Cue { start_ms: 0, end_ms: 1, sheet: "s".into(), x: 0, y: 0, w: 1, h: 1 };
    add("Cue", keys(&cue));
    add("PreviewTrack", keys(&crate::seekr::PreviewTrack { cues: vec![cue], source_duration_ms: 1 }));
    add("Span", keys(&crate::introdb::Span { start: 0.0, end: 1.0 }));
    add("Segments", keys(&crate::introdb::Segments::default()));
    add("Ratings", keys(&crate::ratings::Ratings::default()));
    add("CmdError", keys(&CmdError::Other("x".into())));

    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../contract/app.json");
    let actual = Value::Object(types);
    let written: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert!(written == actual, "contract/app.json should read:\n{}", render(&actual));
}

/// Every `CmdError` code, checked against `contract/error-codes.json`, which
/// `tests/contract.test.ts` holds against `CommandErrorCode` in `src/lib/errors.ts`.
#[test]
fn error_codes_match_contract() {
    use polar_addon::AddonError;
    use polar_index::IndexError;
    let http = reqwest::Client::new().get("http://[::1").build().unwrap_err();
    let all = [
        CmdError::Index(IndexError::NotFound),
        CmdError::Index(IndexError::UnsupportedId("x".into())),
        CmdError::Index(IndexError::Upstream("x".into())),
        CmdError::Addon(AddonError::Http(http)),
        CmdError::Addon(AddonError::Decode("x".into())),
        CmdError::NotFound("x".into()),
        CmdError::Unsupported("x".into()),
        CmdError::Upstream("x".into()),
        CmdError::Save("x".into()),
        CmdError::Source("x".into()),
        CmdError::Player("x".into()),
        CmdError::Other("x".into()),
    ];
    // A new variant fails to compile here until it is added to `all` above.
    for e in &all {
        match e {
            CmdError::Index(IndexError::NotFound | IndexError::UnsupportedId(_) | IndexError::Upstream(_))
            | CmdError::Addon(AddonError::Http(_) | AddonError::Decode(_))
            | CmdError::NotFound(_)
            | CmdError::Unsupported(_)
            | CmdError::Upstream(_)
            | CmdError::Save(_)
            | CmdError::Source(_)
            | CmdError::Player(_)
            | CmdError::Other(_) => {}
        }
    }
    let mut codes: Vec<_> = all.iter().map(CmdError::code).collect();
    codes.sort();
    codes.dedup();
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../contract/error-codes.json");
    let written: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert!(written == json!(codes), "contract/error-codes.json should read:\n{}\n", json!(codes));
}
