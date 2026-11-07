//! What reaches the player from outside: the autocrop probe's screenshots and the links the web
//! view asks mpv to open.
#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let _ = polar_player::png::decode_stored(data);
    if let Ok(text) = std::str::from_utf8(data) {
        let _ = polar_player::allow::is_web_url(text);
        let _ = polar_addon::probe::content_range(text);
    }
});
