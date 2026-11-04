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
  { title: "Countdown", page: "playback", keywords: "autoplay next episode timer seconds up next" },
  { title: "Ask if you're still watching", page: "playback", keywords: "are you still watching sleep timer autoplay stop" },
  { title: "Mature content", page: "browsing", keywords: "nsfw ecchi family friendly kids blur hide adult" },
  { title: "Suggest genres", page: "browsing", keywords: "search suggestions genres dropdown" },
  { title: "Show Up Next", page: "playback", keywords: "next episode card credits end post-play" },
  { title: "Skip intros", page: "playback", keywords: "opening credits auto skip intro" },
  { title: "Skip recaps", page: "playback", keywords: "previously on auto skip recap" },
  { title: "Use the file's own chapters for intros", page: "playback", keywords: "intro recap credits skip p2p chapters introdb" },
  { title: "Resume where you left off", page: "playback", keywords: "continue position start beginning" },
  { title: "Back up when resuming", page: "playback", keywords: "rewind resume seconds" },
  { title: "Count as watched at", page: "playback", keywords: "watched threshold percent played finished mark" },
  { title: "Start in fullscreen", page: "playback", keywords: "full screen" },
  { title: "Pause when minimized", page: "playback", keywords: "minimise background" },
  { title: "Remember playback speed", page: "playback", keywords: "rate faster slower" },
  { title: "Clock", page: "playback", keywords: "time remaining elapsed ends at end time" },
  { title: "Skip forward and back", page: "playback", keywords: "seek amount seconds arrow keys" },
  { title: "Hide controls after", page: "playback", keywords: "overlay timeout auto hide" },
  { title: "Clicking the video", page: "playback", keywords: "click pause tap" },
  { title: "Scrolling over the video", page: "playback", keywords: "mouse wheel scroll volume seek" },

  // Sources
  { title: "Highest quality", page: "sources", keywords: "resolution 4k 1080p 720p max limit filter" },
  { title: "Largest movie file", page: "sources", keywords: "size gb limit filter" },
  { title: "Largest episode file", page: "sources", keywords: "size gb limit filter" },
  { title: "Hide cinema recordings", page: "sources", keywords: "cam telesync ts filter" },
  { title: "Hide Sources Containing", page: "sources", keywords: "keywords exclude words filter hc 3d" },
  { title: "Sort by", page: "sources", keywords: "source list order sort" },
  { title: "Match my screen", page: "sources", keywords: "resolution display 4k 1080p recommended monitor" },
  { title: "Crop black bars", page: "advanced", keywords: "autocrop crop letterbox black bars ultrawide 21:9 aspect" },
  { title: "Filters hide other sources", page: "sources", keywords: "filter strict soft sort order language audio source group" },
  { title: "Turn On When Available", page: "sources", keywords: "dolby vision hdr remux atmos tags filters automatic" },

  // Subtitles & Audio
  { title: "Audio", page: "subtitles", keywords: "audio language dub" },
  { title: "Subtitles", page: "subtitles", keywords: "subtitle language captions" },
  { title: "Show subtitles", page: "subtitles", keywords: "foreign audio forced only when" },
  { title: "Boost dialogue", page: "subtitles", keywords: "voices clear center centre channel surround quiet speech" },
  { title: "Even out volume", page: "subtitles", keywords: "night mode loudness normalize compression leveling" },
  { title: "Subtitle Style", page: "subtitles", keywords: "captions appearance" },
  { title: "Delay", page: "subtitles", keywords: "subtitle sync offset timing" },
  { title: "Font", page: "subtitles", keywords: "subtitle typeface family opendyslexic dyslexia dyslexic accessibility" },
  { title: "Size", page: "subtitles", keywords: "subtitle text font" },
  { title: "Position", page: "subtitles", keywords: "subtitle raise height" },
  { title: "Color", page: "subtitles", keywords: "subtitle colour text" },
  { title: "Opacity", page: "subtitles", keywords: "subtitle transparency" },
  { title: "Outline", page: "subtitles", keywords: "subtitle edge stroke shadow" },
  { title: "Background", page: "subtitles", keywords: "subtitle box" },

  // Appearance
  { title: "Accent colour", page: "appearance", keywords: "color theme highlight" },
  { title: "Background", page: "appearance", keywords: "theme black oled dark" },
  { title: "Interface size", page: "appearance", keywords: "zoom scale bigger smaller text" },
  { title: "Card size", page: "appearance", keywords: "posters thumbnails bigger smaller" },
  { title: "Font", page: "appearance", keywords: "text typeface inter system opendyslexic dyslexia dyslexic accessibility readability" },
  { title: "Reduce motion", page: "appearance", keywords: "animations accessibility" },

  // Browsing
  { title: "Open the app on", page: "browsing", keywords: "start page startup home library" },
  { title: "Titles and descriptions", page: "browsing", keywords: "metadata language tmdb" },
  { title: "Rotate the featured titles", page: "browsing", keywords: "carousel hero autoplay" },
  { title: "Show Continue Watching", page: "browsing", keywords: "home row" },
  { title: "Blur unwatched episode pictures", page: "browsing", keywords: "spoilers thumbnails stills" },
  { title: "Hide unwatched episode descriptions", page: "browsing", keywords: "spoilers synopsis summary" },
  { title: "Remember recent searches", page: "browsing", keywords: "history privacy" },
  { title: "Show titles", page: "browsing", keywords: "cards names" },
  { title: "Show details", page: "browsing", keywords: "cards year" },
  { title: "Show IMDb ratings", page: "browsing", keywords: "cards rating score badge imdb posters" },
  { title: "Rating position", page: "browsing", keywords: "imdb badge on poster under corner overlay" },
  { title: "Play trailers on title pages", page: "browsing", keywords: "trailer autoplay background video youtube" },
  { title: "With sound", page: "browsing", keywords: "trailer muted audio volume" },
  { title: "Show the Calendar", page: "browsing", keywords: "calendar upcoming episodes schedule air dates new" },
  { title: "Colour-code IMDb ratings", page: "browsing", keywords: "color colour rating score badge imdb yellow green red" },
  { title: "Default layout", page: "browsing", keywords: "episodes list grid" },

  // Anime
  { title: "Show Anime", page: "anime", keywords: "anime section tab hide remove turn off disable" },
  { title: "Anime titles", page: "anime", keywords: "anime romaji english japanese native names language" },
  { title: "Voice actors", page: "anime", keywords: "anime dub sub seiyuu japanese english characters" },
  { title: "Shelves", page: "anime", keywords: "anime rows featured carousel airing today season trending upcoming top rated popular movies genres" },
  { title: "Show scores", page: "anime", keywords: "anime anilist rating badge cards posters" },
  { title: "Score format", page: "anime", keywords: "anime anilist rating percent out of ten" },
  { title: "Show airing countdowns", page: "anime", keywords: "anime next episode timer cards posters" },
  { title: "List every show", page: "anime", keywords: "anime schedule shorts regional all" },
  { title: "Hide filler episodes", page: "anime", keywords: "anime filler canon skip" },
  { title: "Hide recap episodes", page: "anime", keywords: "anime recap skip" },
  { title: "Hide 4K sources", page: "anime", keywords: "anime 4k 2160p upscale ai sources quality" },
  { title: "Show spoiler tags", page: "anime", keywords: "anime tags spoilers anilist" },

  // Controls & TV
  { title: "TV mode", page: "controls", keywords: "couch fullscreen remote" },
  { title: "TV mode button in the top bar", page: "controls", keywords: "tv navbar hide show button icon" },
  { title: "Interface sounds", page: "controls", keywords: "audio clicks" },
  { title: "Sound pack", page: "controls", keywords: "interface sounds" },
  { title: "Sound volume", page: "controls", keywords: "interface sounds loudness" },
  { title: "Keyboard Shortcuts", page: "controls", keywords: "keybinds hotkeys keys" },

  // Controller
  { title: "Connection notices", page: "controller", keywords: "controller gamepad toast" },
  { title: "Suggest TV mode", page: "controller", keywords: "controller gamepad" },
  { title: "Button labels", page: "controller", keywords: "controller gamepad xbox playstation nintendo glyphs icons" },
  { title: "Button hints", page: "controller", keywords: "controller gamepad bottom bar help" },
  { title: "Left stick moves too", page: "controller", keywords: "controller gamepad analog thumbstick navigation" },
  { title: "Stick sensitivity", page: "controller", keywords: "controller gamepad analog deadzone" },
  { title: "Repeat speed", page: "controller", keywords: "controller gamepad dpad d-pad hold scroll fast" },
  { title: "Buttons while browsing", page: "controller", keywords: "controller gamepad buttons remap bindings dpad d-pad" },
  { title: "Buttons in the player", page: "controller", keywords: "controller gamepad buttons remap bindings" },
  { title: "Up and down change the volume", page: "controller", keywords: "controller gamepad dpad d-pad player" },

  // Add-ons
  { title: "Installed", page: "addons", keywords: "add-ons addons remove" },
  { title: "Install from URL", page: "addons", keywords: "add-on addon manifest stremio" },

  // Marketplace
  { title: "OpenSubtitles", page: "marketplace", keywords: "add-ons addons subtitles captions install store" },
  { title: "Add-on Marketplace", page: "marketplace", keywords: "add-ons addons store browse search install plugins" },

  // Services
  { title: "Artwork and episode info", page: "services", keywords: "tmdb api key metadata posters" },
  { title: "Critic and audience scores", page: "services", keywords: "rotten tomatoes metacritic letterboxd trakt mdblist omdb ratings reviews" },
  { title: "p2p playback", page: "services", keywords: "bridge source" },
  { title: "Timeline previews", page: "services", keywords: "seekr thumbnails scrubbing" },

  // Advanced
  { title: "Hardware decoding", page: "advanced", keywords: "gpu hwdec green glitches black" },
  { title: "Smooth colour banding", page: "advanced", keywords: "deband gradients color" },
  { title: "Buffer", page: "advanced", keywords: "cache read ahead memory stutter" },
  { title: "Reset all settings", page: "advanced", keywords: "defaults restore" },

  // About & Updates
  { title: "Version", page: "about", keywords: "about build number" },
  { title: "Software update", page: "about", keywords: "check for updates upgrade new version install" },
  { title: "Download updates automatically", page: "about", keywords: "auto update background" },
  { title: "Release notes", page: "about", keywords: "changelog what's new" },
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
