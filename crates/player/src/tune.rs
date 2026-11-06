//! Device-level picture and sound options, as mpv settings.

use crate::sampler::Sampling;

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
    /// With autocrop, where mpv is its own process (Windows, Linux): our
    /// detector reads a screenshot of every frame instead of cropdetect
    /// (docs/autocrop.md §2). Off: screenshots only around cropdetect's
    /// changes. macOS always reads every frame, in memory.
    #[serde(default)]
    pub every_frame: bool,
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
            every_frame: false,
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

    /// Whether autocrop runs cropdetect inside mpv. Not on macOS, where
    /// libmpv hands our detector every frame, nor with [`Tune::every_frame`].
    pub fn cropdetect(&self) -> bool {
        self.autocrop && !self.every_frame && !cfg!(target_os = "macos")
    }

    /// Which frames our detector reads, with autocrop on ([`crate::sampler`]).
    pub fn sampling(&self) -> Sampling {
        if self.every_frame || cfg!(target_os = "macos") {
            Sampling::EveryFrame
        } else {
            Sampling::AroundChanges
        }
    }

    /// Hardware decoding. cropdetect needs the decoded frames in memory, so
    /// while it runs they're copied back from the GPU. Screenshots for our
    /// detector are taken from the GPU and need no copy-back.
    pub fn hwdec_mode(&self) -> &'static str {
        match (self.hwdec, self.cropdetect()) {
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

/// [`Tune::hwdec_mode`] for mpv on Android, whose `auto-safe` list leaves MediaCodec out:
/// MediaCodec straight to the screen, or copied back to memory when frames must be read.
pub fn android_hwdec(mode: &str) -> &str {
    match mode {
        "auto-safe" => "mediacodec,mediacodec-copy",
        "auto-copy-safe" => "mediacodec-copy",
        other => other,
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
            every_frame: false,
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
        assert!(!serde_json::from_str::<Tune>(page).unwrap().every_frame);
    }

    #[test]
    fn every_frame_replaces_cropdetect_and_its_copy_back() {
        let on = Tune { autocrop: true, ..Tune::default() };
        let every = Tune { every_frame: true, ..on };
        assert!(!every.cropdetect());
        assert_eq!(every.sampling(), Sampling::EveryFrame);
        assert_eq!(every.hwdec_mode(), "auto-safe");
        assert!(!Tune { autocrop: false, ..on }.cropdetect());
        if cfg!(target_os = "macos") {
            assert!(!on.cropdetect());
            assert_eq!(on.sampling(), Sampling::EveryFrame);
        } else {
            assert!(on.cropdetect());
            assert_eq!(on.sampling(), Sampling::AroundChanges);
            assert_eq!(on.hwdec_mode(), "auto-copy-safe");
        }
    }

    #[test]
    fn android_uses_mediacodec() {
        let on = Tune::default();
        assert_eq!(android_hwdec(on.hwdec_mode()), "mediacodec,mediacodec-copy");
        assert_eq!(android_hwdec(Tune { autocrop: true, ..on }.hwdec_mode()), "mediacodec-copy");
        assert_eq!(android_hwdec(Tune { hwdec: false, ..on }.hwdec_mode()), "no");
    }
}
