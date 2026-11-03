import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import { usePrefs } from "../../lib/prefs";
import type { MpvMedia } from "./mpvMedia";

/**
 * This machine's sound and picture options (Settings → Subtitles & Audio,
 * → Advanced) applied to mpv: on load, when the audio track changes, and
 * whenever one of them is switched. Rust turns them into fixed mpv values
 * (player.rs `Tune`).
 */
export function useMpvTune(mpv: MpvMedia | null) {
  const { dialogueBoost, volumeLeveling, hwdec, deband, buffer } = usePrefs();

  useEffect(() => {
    if (!mpv) return;
    const apply = () => {
      // Folding down only helps (and only makes sense) with a centre channel.
      const track = mpv.tracks.find((t) => t.type === "audio" && t.id === mpv.aid);
      const surround = (track?.["demux-channel-count"] ?? 0) > 2;
      void invoke("mpv_tune", {
        tune: { dialogueBoost: dialogueBoost && surround, volumeLeveling, hwdec, deband, buffer },
      }).catch(() => {});
    };
    apply();
    mpv.addEventListener("loadedmetadata", apply);
    mpv.addEventListener("tracks", apply);
    return () => {
      mpv.removeEventListener("loadedmetadata", apply);
      mpv.removeEventListener("tracks", apply);
    };
  }, [mpv, dialogueBoost, volumeLeveling, hwdec, deband, buffer]);
}
