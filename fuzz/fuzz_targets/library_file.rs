//! The library file (polarity.json's spaces, as another device or an older version wrote them)
//! and file names made from add-on titles.
#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let _ = serde_json::from_slice::<polar_library::space::Space>(data);
    if let Ok(text) = std::str::from_utf8(data) {
        let _ = polar_library::filenames::safe_name(text);
    }
});
