import { langMatches } from "../../lib/playback";
import type { MpvTrack } from "./mpvMedia";

/** The menus' id for "no subtitles". */
export const OFF = "off";

/**
 * The audio or main subtitle track mpv is playing. `aid`/`sid` read back as
 * "auto" whenever mpv chose the track itself (the file's default, the preferred
 * language, a choice kept from the last file), so the track list's `selected`
 * flags come first; the id only stands in while the list carries no flags. A
 * subtitle with `main-selection` 1 is the secondary one.
 */
export function playingTrack(tracks: MpvTrack[], type: "audio" | "sub", id: number | string | null) {
  return tracks.some((t) => typeof t.selected === "boolean")
    ? tracks.find((t) => t.type === type && t.selected && !t["main-selection"])
    : tracks.find((t) => t.type === type && t.id === id);
}

/**
 * Which audio and subtitle entries the player menus mark as selected, from what
 * mpv is actually playing (see `playingTrack`), not from what the app last asked.
 *
 * `subId` is undefined for an add-on subtitle that matches no entry in `addon`:
 * the caller keeps what it shows.
 */
export function mpvSelection(
  tracks: MpvTrack[],
  aid: number | string | null,
  sid: number | string | null,
  addon: { lang: string; url: string }[],
): { audioId?: string; subId?: string } {
  const audio = playingTrack(tracks, "audio", aid);
  const sub = playingTrack(tracks, "sub", sid);
  let subId: string | undefined;
  if (!sub) subId = OFF;
  else if (!sub.external) subId = `emb:${sub.id}`;
  else {
    const ext = addon.find((x) => x.url === sub["external-filename"]) ?? addon.find((x) => langMatches(sub.lang, x.lang));
    if (ext) subId = `ext:${ext.lang}`;
  }
  return { audioId: audio ? String(audio.id) : undefined, subId };
}
