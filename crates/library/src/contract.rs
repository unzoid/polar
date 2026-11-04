//! The JSON field names of this crate's types as the app sends them to the UI,
//! checked against `contract/library.json` (see `polar_addon`'s `contract.rs`,
//! which this follows). On a mismatch the test prints the file as it now
//! should read.

use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::{AnimeLink, LibraryItem, Progress, SyncLibraryItem};

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

#[test]
fn field_names_match_contract() {
    let mut types = Map::new();
    let mut add = |name: &str, keys: Value| types.insert(name.into(), keys);
    let item = LibraryItem {
        id: "tt1".into(),
        ty: "series".into(),
        name: "Show".into(),
        poster: Some("p".into()),
        added_at: 1,
        updated_at: 2,
    };
    add("LibraryItem", keys(&item));
    add("SyncLibraryItem", keys(&SyncLibraryItem::present(&item)));
    add(
        "Progress",
        keys(&Progress {
            meta_id: "tt1".into(),
            video_id: "tt1:1:1".into(),
            ty: "series".into(),
            name: "Show".into(),
            background: Some("b".into()),
            poster: Some("p".into()),
            season: Some(1),
            episode: Some(1),
            episode_title: Some("Pilot".into()),
            stream: Some(polar_addon::Stream::default()),
            position: 1.0,
            duration: 2.0,
            updated_at: 1,
        }),
    );
    add(
        "AnimeLink",
        keys(&AnimeLink { canonical: "tt1".into(), anilist: 1, mal: Some(1), kitsu: Some(1), updated_at: 1 }),
    );

    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../contract/library.json");
    let actual = Value::Object(types);
    let written: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert!(written == actual, "contract/library.json should read:\n{}", render(&actual));
}
