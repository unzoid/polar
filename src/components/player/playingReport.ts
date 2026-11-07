import type { PlayingReport } from "../../lib/playback";
import { isMpv, type MediaLike } from "./mpvMedia";

/** mpv's properties for the source info panel (#229); one that fails or is missing is left out. */
const PROPS = ["file-format", "video-codec", "video-params", "container-fps", "video-bitrate", "audio-bitrate"] as const;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined);

/** What the player reports about the file it's playing: mpv's properties, or the built-in player's size. */
export async function playingReport(media: MediaLike | null): Promise<PlayingReport | undefined> {
  if (!media) return undefined;
  if (!isMpv(media)) {
    const v = media as Partial<HTMLVideoElement>;
    return v.videoWidth ? { width: v.videoWidth, height: v.videoHeight } : undefined;
  }
  const values = await Promise.all(PROPS.map((p) => media.command("get_property", p).catch(() => undefined)));
  const [format, codec, params, fps, vbr, abr] = values as unknown[];
  const p = (params ?? {}) as { w?: number; h?: number };
  return {
    container: typeof format === "string" ? format : undefined,
    videoCodec: typeof codec === "string" ? codec : undefined,
    width: num(p.w),
    height: num(p.h),
    fps: num(fps),
    videoBitrate: num(vbr),
    audioBitrate: num(abr),
    tracks: media.tracks.map((t) => ({
      type: t.type,
      lang: t.lang,
      title: t.title,
      codec: t.codec,
      selected: t.selected,
      channels: t["demux-channel-count"],
    })),
  };
}
