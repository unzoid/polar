//! Subtitle files from add-ons (SRT or WebVTT, any encoding) turned into WebVTT.
#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &[u8]| {
    let _ = polar_addon::subs::to_vtt(data);
});
