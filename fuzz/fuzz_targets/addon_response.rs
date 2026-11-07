//! An add-on's JSON answers: manifest, catalog, meta, streams and subtitles, then what the app
//! reads from them (which resources it serves, each stream's quality).
#![no_main]

use libfuzzer_sys::fuzz_target;
use polar_addon::rank::parse_quality;
use polar_addon::types::{CatalogResponse, Manifest, MetaResponse, StreamsResponse, SubtitlesResponse};

fuzz_target!(|data: &[u8]| {
    if let Ok(manifest) = serde_json::from_slice::<Manifest>(data) {
        let _ = manifest.serves("stream", "movie", "tt0000000");
        let _ = manifest.serves("meta", "series", "kitsu:1");
    }
    let _ = serde_json::from_slice::<CatalogResponse>(data);
    let _ = serde_json::from_slice::<MetaResponse>(data);
    let _ = serde_json::from_slice::<SubtitlesResponse>(data);
    if let Ok(streams) = serde_json::from_slice::<StreamsResponse>(data) {
        for stream in &streams.streams {
            let _ = parse_quality(stream);
        }
    }
});
