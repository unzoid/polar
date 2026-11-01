import type { PageId } from "../screens/Settings";
import { ACTIONS } from "./keybinds";

/**
 * Every individual setting, for the settings search. `title` is the row's
 * label exactly as it appears on its page, so a result can scroll to it.
 */
export type SettingEntry = { title: string; page: PageId; keywords?: string };

const ROWS: SettingEntry[] = [
  // Account
  { title: "Email", page: "account", keywords: "sign in address sync cloud" },
  { title: "Profiles", page: "account", keywords: "switch who's watching" },
  { title: "Manage profiles", page: "account", keywords: "edit add remove avatar" },
  { title: "Delete account", page: "account", keywords: "danger remove erase" },

  // Playback
  { title: "Play the best source automatically", page: "playback", keywords: "autoplay stream" },
  { title: "Play the next episode automatically", page: "playback", keywords: "autoplay binge" },
  { title: "Skip intros and recaps", page: "playback", keywords: "opening credits" },
  { title: "Use the file's own chapters for intros", page: "playback", keywords: "intro recap credits skip p2p chapters introdb" },
  { title: "Skip forward and back", page: "playback", keywords: "seek amount seconds arrow keys" },

  // Subtitles & Audio
  { title: "Audio", page: "subtitles", keywords: "audio language dub" },
  { title: "Subtitles", page: "subtitles", keywords: "subtitle language captions" },
  { title: "Subtitle Style", page: "subtitles", keywords: "captions appearance" },
  { title: "Delay", page: "subtitles", keywords: "subtitle sync offset timing" },
  { title: "Size", page: "subtitles", keywords: "subtitle text font" },
  { title: "Position", page: "subtitles", keywords: "subtitle raise height" },
  { title: "Color", page: "subtitles", keywords: "subtitle colour text" },
  { title: "Opacity", page: "subtitles", keywords: "subtitle transparency" },
  { title: "Outline", page: "subtitles", keywords: "subtitle edge stroke shadow" },
  { title: "Background", page: "subtitles", keywords: "subtitle box" },

  // Browsing
  { title: "Show titles", page: "browsing", keywords: "cards names" },
  { title: "Show details", page: "browsing", keywords: "cards year rating" },
  { title: "Default layout", page: "browsing", keywords: "episodes list grid" },
  { title: "Font", page: "browsing", keywords: "text typeface inter" },

  // Controls & TV
  { title: "TV mode", page: "controls", keywords: "couch fullscreen remote" },
  { title: "Interface sounds", page: "controls", keywords: "audio clicks" },
  { title: "Sound pack", page: "controls", keywords: "interface sounds" },
  { title: "Sound volume", page: "controls", keywords: "interface sounds loudness" },
  { title: "Connection notices", page: "controls", keywords: "controller gamepad toast" },
  { title: "Suggest TV mode", page: "controls", keywords: "controller gamepad" },
  { title: "Keyboard Shortcuts", page: "controls", keywords: "keybinds hotkeys keys" },

  // Add-ons
  { title: "Installed", page: "addons", keywords: "add-ons addons remove" },
  { title: "Install from URL", page: "addons", keywords: "add-on addon manifest stremio" },

  // Services
  { title: "Artwork and episode info", page: "services", keywords: "tmdb api key metadata posters" },
  { title: "p2p playback", page: "services", keywords: "bridge source" },
  { title: "Timeline previews", page: "services", keywords: "seekr thumbnails scrubbing" },
];

/** Each rebindable shortcut, found under Controls & TV. */
const SHORTCUTS: SettingEntry[] = ACTIONS.map((a) => ({
  title: a.label,
  page: "controls",
  keywords: "keyboard shortcut keybind hotkey",
}));

export const SETTINGS_INDEX: SettingEntry[] = [...ROWS, ...SHORTCUTS];

/**
 * Settings matching a query, best first: titles starting with it, then titles
 * containing it, then matches on the page name or keywords.
 */
export function searchSettings(query: string, pageLabel: (id: PageId) => string, pages: Set<PageId>) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { entry: SettingEntry; score: number; i: number }[] = [];
  SETTINGS_INDEX.forEach((entry, i) => {
    if (!pages.has(entry.page)) return;
    const title = entry.title.toLowerCase();
    const score = title.startsWith(q)
      ? 0
      : title.split(/\W+/).some((w) => w.startsWith(q))
        ? 1
        : title.includes(q)
          ? 2
          : `${pageLabel(entry.page)} ${entry.keywords ?? ""}`.toLowerCase().includes(q)
            ? 3
            : -1;
    if (score >= 0) scored.push({ entry, score, i });
  });
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map((s) => s.entry);
}
