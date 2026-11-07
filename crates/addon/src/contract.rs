//! The JSON field names of this crate's types as the app sends them to the UI,
//! checked against `contract/addon.json`. `src/lib/contract.ts` is checked
//! against the same file (`tests/contract.test.ts`), so renaming a field on
//! one side fails a test instead of reaching the UI as `undefined`. Every
//! optional field is filled so that none is skipped. On a mismatch the test
//! prints the file as it now should read.

use serde::Serialize;
use serde_json::{json, Map, Value};

use crate::probe::Readiness;
use crate::rank::{RankedStream, ScoreReason, StreamQuality};
use crate::types::*;

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

fn preview() -> MetaPreview {
    MetaPreview {
        id: "tt1".into(),
        ty: "series".into(),
        name: "Show".into(),
        poster: s("p"),
        background: s("b"),
        logo: s("l"),
        logos: vec!["l".into()],
        description: s("d"),
        release_info: s("2024"),
        imdb_rating: s("7.5"),
        genres: vec!["Drama".into()],
    }
}

fn stream() -> Stream {
    Stream {
        url: s("https://a.io/v.mkv"),
        yt_id: s("y"),
        external_url: s("https://a.io"),
        info_hash: s("0123456789abcdef0123456789abcdef01234567"),
        file_idx: Some(0),
        sources: Some(vec!["tracker:udp://tracker.example.org:1337/announce".into()]),
        name: s("n"),
        title: s("t"),
        description: s("d"),
        behavior_hints: Some(json!({})),
    }
}

#[test]
fn field_names_match_contract() {
    let mut types = Map::new();
    let mut add = |name: &str, keys: Value| types.insert(name.into(), keys);
    add(
        "Manifest",
        keys(&Manifest {
            id: "a".into(),
            version: "1".into(),
            name: "A".into(),
            description: s("d"),
            logo: s("l"),
            resources: vec![ManifestResource::Name("stream".into())],
            types: vec!["movie".into()],
            catalogs: vec![],
            id_prefixes: Some(vec!["tt".into()]),
            behavior_hints: Some(BehaviorHints::default()),
        }),
    );
    add("BehaviorHints", keys(&BehaviorHints::default()));
    add("MetaPreview", keys(&preview()));
    let details = MetaDetails {
        tagline: s("t"),
        status: s("Ended"),
        released: s("2024-01-01"),
        countries: vec!["US".into()],
        languages: vec!["en".into()],
        studios: vec!["S".into()],
        writers: vec!["W".into()],
        awards: s("a"),
        budget: Some(1),
        revenue: Some(1),
        seasons: Some(1),
        episodes: Some(1),
        votes: Some(1),
        tmdb_id: Some(1),
    };
    add("MetaDetails", keys(&details));
    let person = Person { name: "P".into(), character: s("C"), photo: s("p") };
    add("Person", keys(&person));
    let video = Video {
        id: "tt1:1:1".into(),
        title: "Pilot".into(),
        season: 1,
        episode: 1,
        released: s("2024-01-01"),
        thumbnail: s("t"),
        overview: s("o"),
        rating: s("8"),
    };
    add("Video", keys(&video));
    add(
        "Meta",
        keys(&Meta {
            preview: preview(),
            runtime: s("50 min"),
            cast: vec!["A".into()],
            director: vec!["D".into()],
            trailer_yt_id: s("y"),
            trailer_source: s("tmdb"),
            videos: vec![video],
            people: vec![person],
            details,
        }),
    );
    add("Stream", keys(&stream()));
    add("StreamQuality", keys(&StreamQuality::default()));
    add("ScoreReason", keys(&ScoreReason { reason: "4K", points: 40.0 }));
    add("Readiness.ready", keys(&Readiness::Ready { ms: 1 }));
    add("Readiness.notReady", keys(&Readiness::NotReady { reason: "r".into() }));
    add("Readiness.slow", keys(&Readiness::Slow { ms: 1 }));
    add("Readiness.unchecked", keys(&Readiness::Unchecked));
    add(
        "RankedStream",
        keys(&RankedStream {
            stream: stream(),
            addon: "A".into(),
            quality: StreamQuality::default(),
            score: 1.0,
            score_reasons: vec![],
            label: "1080p".into(),
            request_id: s("tt0000001:1:1"),
            file_episode: s("S01E01"),
            other_episode: false,
        }),
    );

    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../contract/addon.json");
    let actual = Value::Object(types);
    let written: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert!(written == actual, "contract/addon.json should read:\n{}", render(&actual));
}
