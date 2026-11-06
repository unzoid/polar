import { useEffect } from "react";
import { call } from "../../lib/platform";
import { usePrefs } from "../../lib/settings";
import { warnFailed } from "../../lib/errors";
import type { MpvMedia } from "./mpvMedia";

/**
 * This machine's sound and picture options (Settings → Subtitles & Audio,
 * → Advanced) applied to mpv: on load, when the audio track changes, and
 * whenever one of them is switched. Rust turns them into fixed mpv values
 * (polar_player `Tune`).
 */
export function useMpvTune(mpv: MpvMedia | null) {
  const { dialogueBoost, volumeLeveling, hwdec, deband, autocrop, autocropLookahead, autocropEveryFrame, buffer } = usePrefs();

  useEffect(() => {
    if (!mpv) return;
    const apply = () => {
      // Folding down only helps (and only makes sense) with a centre channel.
      const track = mpv.playing("audio");
      const surround = (track?.["demux-channel-count"] ?? 0) > 2;
      void call("mpv_tune", {
        tune: {
          dialogueBoost: dialogueBoost && surround,
          volumeLeveling,
          hwdec,
          deband,
          autocrop,
          lookahead: autocropLookahead,
          everyFrame: autocropEveryFrame,
          buffer,
        },
      }).catch(warnFailed("mpv_tune"));
    };
    apply();
    mpv.addEventListener("loadedmetadata", apply);
    mpv.addEventListener("tracks", apply);
    return () => {
      mpv.removeEventListener("loadedmetadata", apply);
      mpv.removeEventListener("tracks", apply);
    };
  }, [mpv, dialogueBoost, volumeLeveling, hwdec, deband, autocrop, autocropLookahead, autocropEveryFrame, buffer]);
}
