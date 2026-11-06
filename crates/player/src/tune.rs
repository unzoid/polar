//! Device-level picture and sound options, as mpv settings.

/// Device-level picture and sound options (Settings → Subtitles & Audio and
/// → Advanced). Presets, not raw values: `af` takes lavfi graphs, which can
/// read files, so the page never gets to write it directly.
#[derive(Debug, Clone, Copy, PartialEq, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tune {
    /// Fold surround down to stereo with the centre (dialogue) channel
    /// louder. Only sent for tracks with more than two channels.
    pub dialogue_boost: bool,
    /// Even out loud and quiet scenes ("night mode").
    pub volume_leveling: bool,
    /// Hardware decoding. Off is a troubleshooting switch for broken drivers.
    pub hwdec: bool,
    /// Smooth colour banding in gradients (dark scenes, anime skies).
    pub deband: bool,
    /// Read-ahead: "small", "normal" or "large".
    pub buffer: BufferSize,
    /// Crop black bars burnt into the picture (a 2.39:1 film inside a 16:9
    /// file), so it fills a wide screen. See [`crate::crop`].
    #[serde(default)]
    pub autocrop: bool,
    /// With autocrop: read keyframes ahead of the playhead so a change of
    /// bars lands on the cut (docs/autocrop.md §4).
    #[serde(default = "on")]
    pub lookahead: bool,
}

fn on() -> bool {
    true
}

#[derive(Debug, Clone, Copy, serde::Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum BufferSize {
    Small,
    Normal,
    Large,
}

/// What mpv's launch arguments (`Mpv::ensure` in src-tauri) amount to.
impl Default for Tune {
    fn default() -> Self {
        Self {
            dialogue_boost: false,
            volume_leveling: false,
            hwdec: true,
            deband: false,
            buffer: BufferSize::Normal,
            autocrop: false,
            lookahead: true,
        }
    }
}

impl Tune {
    pub fn audio_filters(&self) -> String {
        let mut chain: Vec<&str> = Vec::new();
        if self.dialogue_boost {
            // The well-known mpv downmix: centre at full level, the rest at 30%.
            chain.push("lavfi=[pan=stereo|FL<FC+0.30*FL+0.30*BL+0.30*SL|FR<FC+0.30*FR+0.30*BR+0.30*SR]");
        }
        if self.volume_leveling {
            chain.push("lavfi=[dynaudnorm=f=150:g=15:p=0.9]");
        }
        chain.join(",")
    }

    /// Hardware decoding. Measuring the bars needs the decoded frames in
    /// memory, so with autocrop on they're copied back from the GPU.
    pub fn hwdec_mode(&self) -> &'static str {
        match (self.hwdec, self.autocrop) {
            (false, _) => "no",
            (true, false) => "auto-safe",
            (true, true) => "auto-copy-safe",
        }
    }

    /// (seconds ahead, max bytes) for the demuxer cache.
    pub fn cache(&self) -> (u32, &'static str) {
        match self.buffer {
            BufferSize::Small => (30, "64MiB"),
            BufferSize::Normal => (90, "192MiB"),
            BufferSize::Large => (300, "768MiB"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tune_builds_fixed_filters() {
        let t = Tune {
            dialogue_boost: true,
            volume_leveling: true,
            hwdec: true,
            deband: false,
            buffer: BufferSize::Large,
            autocrop: false,
            lookahead: true,
        };
        assert!(t.audio_filters().starts_with("lavfi=[pan=stereo") && t.audio_filters().contains("dynaudnorm"));
        let off = Tune { dialogue_boost: false, volume_leveling: false, ..t };
        assert_eq!(off.audio_filters(), "");
        assert_eq!(t.cache(), (300, "768MiB"));
    }

    #[test]
    fn lookahead_is_on_unless_sent_off() {
        let page = r#"{"dialogueBoost":false,"volumeLeveling":false,"hwdec":true,"deband":false,"buffer":"normal","autocrop":true}"#;
        assert!(serde_json::from_str::<Tune>(page).unwrap().lookahead);
        let off = page.replace('}', r#","lookahead":false}"#);
        assert!(!serde_json::from_str::<Tune>(&off).unwrap().lookahead);
    }
}
