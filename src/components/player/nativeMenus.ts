import type { DialogAction, NativeDialog } from "../../lib/platform";

/**
 * The player's Speed and Subtitles & Audio pickers as iOS's own menus (#174), laid out as AVKit lays out its own:
 * the speeds in one list, Audio and Subtitles as submenus with the current track ticked, Subtitle Settings under
 * them. Sources and Episodes keep the full-screen picker: their rows carry stills, details and filters a menu can't.
 */

type Track = { id: string; label: string };

/** "1x (Normal)", "1.5x". */
export function speedLabel(rate: number) {
  return rate === 1 ? "1x (Normal)" : `${rate}x`;
}

export function speedMenu(speeds: number[], rate: number): Omit<NativeDialog, "anchor"> {
  return {
    kind: "menu",
    title: "Playback Speed",
    actions: speeds.map((r) => ({ id: String(r), label: speedLabel(r), style: "default", checked: r === rate })),
  };
}

/** The speed picked from `speedMenu`, or null. */
export function pickedSpeed(id: string | null): number | null {
  const r = id == null ? NaN : Number(id);
  return Number.isFinite(r) && r > 0 ? r : null;
}

export const SUBTITLE_SETTINGS = "settings";

export function tracksMenu(t: {
  audio: Track[];
  audioId: string | undefined;
  subtitles: Track[];
  subId: string;
  subtitlesLoading: boolean;
}): Omit<NativeDialog, "anchor"> {
  const item =
    (prefix: string, current: string | undefined) =>
    (o: Track): DialogAction => ({
      id: `${prefix}:${o.id}`,
      label: o.label,
      style: "default",
      checked: o.id === current,
    });
  const audio = t.audio.length ? t.audio.map(item("audio", t.audioId)) : [{ id: "audio:default", label: "Default", style: "default" as const, checked: true }];
  return {
    kind: "menu",
    title: "Subtitles & Audio",
    actions: [
      { id: "audio", label: "Audio", style: "default", group: 0, children: audio },
      // The menu is drawn once (and a menu shows no message): subtitles still on their way can't join it, so it says so.
      {
        id: "subtitles",
        label: t.subtitlesLoading ? "Subtitles (more loading…)" : "Subtitles",
        style: "default",
        group: 0,
        children: t.subtitles.map(item("sub", t.subId)),
      },
      { id: SUBTITLE_SETTINGS, label: "Subtitle Settings", style: "default", group: 1 },
    ],
  };
}

/** What was picked from `tracksMenu`: a track ("ext:en" keeps its own colon), the settings, or nothing. */
export function pickedTrack(id: string | null): { audio: string } | { subtitle: string } | "settings" | null {
  if (id === SUBTITLE_SETTINGS) return "settings";
  const at = id?.indexOf(":") ?? -1;
  if (!id || at < 0) return null;
  const [kind, track] = [id.slice(0, at), id.slice(at + 1)];
  if (kind === "audio") return track === "default" ? null : { audio: track };
  if (kind === "sub") return { subtitle: track };
  return null;
}
