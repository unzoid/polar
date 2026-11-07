//! A torrent stream's info hash and `sources` from an add-on: the first line is the hash, the
//! rest are sources.
#![no_main]

use libfuzzer_sys::fuzz_target;
use polar_torrent::magnet::{info_hash, magnet, trackers};

fuzz_target!(|data: &[u8]| {
    let Ok(text) = std::str::from_utf8(data) else { return };
    let mut lines = text.split('\n');
    let hash = info_hash(lines.next().unwrap_or_default());
    let sources: Vec<String> = lines.map(str::to_owned).collect();
    let trackers = trackers(&sources);
    if let Some(hash) = hash {
        let _ = magnet(&hash, &trackers);
    }
});
