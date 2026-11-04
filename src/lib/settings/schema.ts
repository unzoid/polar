import { PREFERRED_LANGUAGES, languageName } from "../languages";
import { isMac } from "../platform";
import type { Prefs } from "../prefs";
import type { Settings } from "../types";
import type { PageId } from "./pages";

/**
 * Every setting once (critique H15, M27): where it lives, what it is called, how it is changed.
 * The settings search, the desktop rows (components/settings/SettingRow.tsx) and TV
 * (tv/TvSettings.tsx) all read it, so they can't disagree on choices, ranges or defaults.
 *
 * An entry without `bind` is a row the page draws itself (a form, a list, a button); it is
 * here so search finds it. An entry with `bind` and `control` can be drawn from this alone.
 */

export type Value = string | number | boolean;
export type Choice<V extends Value = Value> = { value: V; label: string };

export type Bind =
  /** Synced settings. `fallback` stands in for a missing (older) value. */
  | { store: "settings"; key: keyof Settings; fallback: Value }
  /** Prefs (this device or the profile, see prefs.ts); always filled in from DEFAULTS. */
  | { store: "prefs"; key: keyof Prefs };

export type Control =
  | { kind: "toggle" }
  /** `choices` as a function gets the current value (to list a language that isn't in the list). */
  | { kind: "choice"; choices: Choice[] | ((current: Value) => Choice[]) }
  | {
      kind: "number";
      min: number;
      max: number;
      step?: number;
      unit?: string;
      /** What 0 means ("Never", "Don't"). */
      zero?: string;
      /** Shown = stored × scale (a 0-1 volume shown as percent). */
      scale?: number;
      /** TV steps through the range this far apart (left and right are slow on a remote). */
      tvStep?: number;
      /** How TV names a value; default "8 sec", "50%". */
      label?: (n: number) => string;
    };

export type SettingDef = {
  /** Unique; the stored key when there is one. Search results and rows meet on it (`data-setting`). */
  id: string;
  page: PageId;
  /** The row's title on its desktop page. */
  title: string;
  caption?: string;
  /** The control's accessible name, when the title alone is too short ("Audio"). */
  controlLabel?: string;
  /** Extra words the search matches. */
  keywords?: string;
  bind?: Bind;
  control?: Control;
  /** Queries a change makes stale (filters run in Rust when sources are fetched, …). */
  invalidates?: string[][];
  /** The row's label in TV mode, if TV shows it. */
  tv?: string;
};

const SOURCES_STALE = [["streams"]];

/** "Default"/"Off" first, then languages (plus the current one if it isn't in the list). */
export function languageChoices(current: Value, none: string): Choice[] {
  const code = String(current ?? "");
  const codes = code && !PREFERRED_LANGUAGES.includes(code) ? [code, ...PREFERRED_LANGUAGES] : PREFERRED_LANGUAGES;
  return [{ value: "", label: none }, ...codes.map((c) => ({ value: c, label: languageName(c) ?? c }))];
}

/** TMDB's metadata languages, as locales. */
// prettier-ignore
const METADATA_LANGUAGES = [
  "en-US", "en-GB", "es-ES", "es-MX", "fr-FR", "de-DE", "it-IT", "pt-PT", "pt-BR", "nl-NL", "sv-SE", "da-DK", "nb-NO",
  "fi-FI", "pl-PL", "cs-CZ", "hu-HU", "ro-RO", "el-GR", "tr-TR", "ru-RU", "uk-UA", "ar-SA", "he-IL", "hi-IN", "th-TH",
  "vi-VN", "id-ID", "ja-JP", "ko-KR", "zh-CN", "zh-TW",
];
const localeNames = new Intl.DisplayNames(undefined, { type: "language" });
const localeLabel = (code: string) => {
  try {
    return localeNames.of(code) ?? code;
  } catch {
    return code;
  }
};

/** The metadata languages (plus the current one if it isn't in the list), named in the UI's language. */
export function metadataLanguageChoices(current: Value): Choice[] {
  const code = String(current ?? "");
  const codes = code && !METADATA_LANGUAGES.includes(code) ? [code, ...METADATA_LANGUAGES] : METADATA_LANGUAGES;
  return codes.map((c) => ({ value: c, label: localeLabel(c) }));
}

export const RESOLUTION_CHOICES: Choice<number>[] = [
  { value: 0, label: "Any" },
  { value: 2160, label: "4K" },
  { value: 1440, label: "1440p" },
  { value: 1080, label: "1080p" },
  { value: 720, label: "720p" },
  { value: 480, label: "480p" },
];

const s = (key: keyof Settings, fallback: Value): Bind => ({ store: "settings", key, fallback });
const p = (key: keyof Prefs): Bind => ({ store: "prefs", key });
const toggle: Control = { kind: "toggle" };
const choice = (choices: Choice[] | ((current: Value) => Choice[])): Control => ({ kind: "choice", choices });

export const SETTINGS: SettingDef[] = [
  // Account
  { id: "email", page: "account", title: "Email", keywords: "sign in address sync cloud" },
  { id: "profiles", page: "account", title: "Profiles", keywords: "switch who's watching" },
  { id: "manageProfiles", page: "account", title: "Manage profiles", keywords: "edit add remove avatar" },
  { id: "deleteAccount", page: "account", title: "Delete account", keywords: "danger remove erase" },

  // Playback
  {
    id: "autoPickSource",
    page: "playback",
    title: "Play the best source automatically",
    caption: "Start playing as soon as a good source is found, without asking you to pick one",
    keywords: "autoplay stream",
    bind: s("autoPickSource", true),
    control: toggle,
    tv: "Play the Best Source Right Away",
  },
  {
    id: "autoplayNext",
    page: "playback",
    title: "Play the next episode automatically",
    keywords: "autoplay binge",
    bind: s("autoplayNext", true),
    control: toggle,
    tv: "Play Next Episode Automatically",
  },
  {
    id: "autoplayCountdown",
    page: "playback",
    title: "Countdown",
    caption: "How long Up Next waits before it starts the next episode",
    keywords: "autoplay next episode timer seconds up next",
    bind: s("autoplayCountdown", 8),
    control: { kind: "number", min: 3, max: 60, unit: "sec" },
    tv: "Up Next Countdown",
  },
  {
    id: "stillWatchingAfter",
    page: "playback",
    title: "Ask if you're still watching",
    caption: "Stop after this many episodes in a row with no keys or clicks, so a show doesn't play all night",
    keywords: "are you still watching sleep timer autoplay stop",
    bind: s("stillWatchingAfter", 0),
    control: {
      kind: "number",
      min: 0,
      max: 12,
      unit: "episodes",
      zero: "Never",
      label: (n) => (n === 0 ? "Never" : `After ${n} episode${n === 1 ? "" : "s"}`),
    },
    tv: "Ask “Still Watching?”",
  },
  {
    id: "nextUpTiming",
    page: "playback",
    title: "Show Up Next",
    caption: "When the next-episode card appears near the end of an episode",
    keywords: "next episode card credits end post-play",
    bind: s("nextUpTiming", "credits"),
    control: choice([
      { value: "credits", label: "When the credits start" },
      { value: "end", label: "At the very end" },
    ]),
  },
  {
    id: "autoSkip",
    page: "playback",
    title: "Skip intros",
    caption: "Jump past the opening titles on their own",
    keywords: "opening credits auto skip intro",
    bind: s("autoSkip", false),
    control: toggle,
    tv: "Skip Intros",
  },
  { id: "autoSkipRecaps", page: "playback", title: "Skip recaps", keywords: "previously on auto skip recap" },
  {
    id: "preferFileChapters",
    page: "playback",
    title: "Use the file's own chapters for intros",
    caption: "If the video has chapters named Intro, Recap or Credits, use those. Otherwise the online intro database fills in.",
    keywords: "intro recap credits skip chapters introdb",
    bind: p("preferFileChapters"),
    control: toggle,
  },
  {
    id: "resumePlayback",
    page: "playback",
    title: "Resume where you left off",
    caption: "Off: every video starts from the beginning",
    keywords: "continue position start beginning",
    bind: s("resumePlayback", true),
    control: toggle,
    tv: "Resume Where You Left Off",
  },
  {
    id: "resumeRewind",
    page: "playback",
    title: "Back up when resuming",
    caption: "Start a little before where you stopped, to pick up the thread",
    keywords: "rewind resume seconds",
    bind: s("resumeRewind", 0),
    control: { kind: "number", min: 0, max: 60, unit: "sec", zero: "Don't" },
  },
  {
    id: "watchedThreshold",
    page: "playback",
    title: "Count as watched at",
    caption: "How far into a video it moves out of Continue Watching and gets a tick",
    keywords: "watched threshold percent played finished mark",
    bind: s("watchedThreshold", 92),
    control: { kind: "number", min: 50, max: 100, unit: "%" },
    invalidates: [["continue"], ["history"]],
  },
  { id: "startFullscreen", page: "playback", title: "Start in fullscreen", keywords: "full screen", bind: s("startFullscreen", false), control: toggle },
  {
    id: "pauseOnMinimize",
    page: "playback",
    title: "Pause when minimized",
    caption: "On this device",
    keywords: "minimise background",
    bind: p("pauseOnMinimize"),
    control: toggle,
  },
  { id: "rememberSpeed", page: "playback", title: "Remember playback speed", keywords: "rate faster slower" },
  {
    id: "timeDisplay",
    page: "playback",
    title: "Clock",
    caption: "What the time next to the timeline shows. Clicking it there switches too.",
    keywords: "time remaining elapsed ends at end time",
    bind: s("timeDisplay", "remaining"),
    control: choice([
      { value: "remaining", label: "Time left" },
      { value: "elapsed", label: "Elapsed / total" },
      { value: "endsAt", label: "Ends at" },
    ]),
  },
  {
    id: "seekStep",
    page: "playback",
    title: "Skip forward and back",
    caption: "How far the skip buttons and the left and right arrow keys jump",
    keywords: "seek amount seconds arrow keys",
    bind: s("seekStep", 10),
    control: { kind: "number", min: 1, max: 120, unit: "sec", tvStep: 5 },
    tv: "Seek Step",
  },
  {
    id: "controlsHideSecs",
    page: "playback",
    title: "Hide controls after",
    caption: "Without moving the mouse",
    keywords: "overlay timeout auto hide",
    bind: s("controlsHideSecs", 2),
    control: { kind: "number", min: 1, max: 15, unit: "sec" },
  },
  {
    id: "clickAction",
    page: "playback",
    title: "Clicking the video",
    keywords: "click pause tap",
    bind: s("clickAction", "toggle"),
    control: choice([
      { value: "toggle", label: "Plays or pauses" },
      { value: "controls", label: "Shows the controls" },
    ]),
  },
  {
    id: "wheelAction",
    page: "playback",
    title: "Scrolling over the video",
    keywords: "mouse wheel scroll volume seek",
    bind: s("wheelAction", "volume"),
    control: choice([
      { value: "volume", label: "Changes volume" },
      { value: "seek", label: "Skips back and forward" },
      { value: "none", label: "Does nothing" },
    ]),
  },

  // Sources
  {
    id: "maxResolution",
    page: "sources",
    title: "Highest quality",
    caption: "Leave out anything sharper, for a slow connection or an older screen",
    keywords: "resolution 4k 1080p 720p max limit filter",
    bind: s("maxResolution", 0),
    control: choice(RESOLUTION_CHOICES),
    invalidates: SOURCES_STALE,
    tv: "Highest Quality",
  },
  {
    id: "maxMovieSizeGb",
    page: "sources",
    title: "Largest movie file",
    caption: "Big files take longer to start and can stall on a slower connection",
    keywords: "size gb limit filter",
    bind: s("maxMovieSizeGb", 0),
    control: { kind: "number", min: 0, max: 100, step: 0.5, unit: "GB", zero: "Any size" },
    invalidates: SOURCES_STALE,
  },
  {
    id: "maxEpisodeSizeGb",
    page: "sources",
    title: "Largest episode file",
    keywords: "size gb limit filter",
    bind: s("maxEpisodeSizeGb", 0),
    control: { kind: "number", min: 0, max: 30, step: 0.5, unit: "GB", zero: "Any size" },
    invalidates: SOURCES_STALE,
  },
  {
    id: "hideCam",
    page: "sources",
    title: "Hide cinema recordings",
    caption: "CAM and telesync copies, filmed in a cinema",
    keywords: "cam telesync ts filter",
    bind: s("hideCam", true),
    control: toggle,
    invalidates: SOURCES_STALE,
    tv: "Hide CAM Recordings",
  },
  { id: "excludeKeywords", page: "sources", title: "Hide Sources Containing", keywords: "keywords exclude words filter hc 3d" },
  {
    id: "sourceSort",
    page: "sources",
    title: "Sort by",
    caption: "How the Sources list in the player is ordered when it opens",
    keywords: "source list order sort",
    bind: s("sourceSort", "best"),
    control: choice([
      { value: "best", label: "Best match" },
      { value: "quality", label: "Highest quality" },
      { value: "sizeDesc", label: "Largest file" },
      { value: "sizeAsc", label: "Smallest file" },
    ]),
    invalidates: SOURCES_STALE,
    tv: "Sort Sources By",
  },
  {
    id: "preferScreenResolution",
    page: "sources",
    title: "Match my screen",
    keywords: "resolution display 4k 1080p recommended monitor",
    bind: s("preferScreenResolution", true),
    control: toggle,
    invalidates: SOURCES_STALE,
    tv: "Match My Screen",
  },
  {
    id: "sourceFiltersHide",
    page: "sources",
    title: "Filters hide other sources",
    caption:
      "Off: sources matching your filters come first and the rest stay below them, so a missing language or size never leaves you with nothing to pick",
    keywords: "filter strict soft sort order language audio source group",
    bind: s("sourceFiltersHide", false),
    control: toggle,
    invalidates: SOURCES_STALE,
    tv: "Filters Hide Other Sources",
  },
  { id: "sourceAutoTags", page: "sources", title: "Turn On When Available", keywords: "dolby vision hdr remux atmos tags filters automatic" },

  // Subtitles & Audio
  {
    id: "audioLanguage",
    page: "subtitles",
    title: "Audio",
    controlLabel: "Audio language",
    keywords: "audio language dub",
    bind: s("audioLanguage", ""),
    control: choice((current) => languageChoices(current, "Default")),
    tv: "Audio Language",
  },
  {
    id: "subtitleLanguage",
    page: "subtitles",
    title: "Subtitles",
    controlLabel: "Subtitle language",
    keywords: "subtitle language captions",
    bind: s("subtitleLanguage", ""),
    control: choice((current) => languageChoices(current, "Off")),
    tv: "Subtitles",
  },
  {
    id: "subtitleMode",
    page: "subtitles",
    title: "Show subtitles",
    caption: "Only for foreign audio: turn them on when the audio isn't already in your subtitle language",
    keywords: "foreign audio forced only when",
    bind: s("subtitleMode", "always"),
    control: choice([
      { value: "always", label: "Always" },
      { value: "foreign", label: "Only for foreign audio" },
    ]),
  },
  {
    id: "dialogueBoost",
    page: "subtitles",
    title: "Boost dialogue",
    caption: "Makes voices clearer on surround (5.1 and 7.1) audio by turning the centre channel up and the rest down",
    keywords: "voices clear center centre channel surround quiet speech",
    bind: p("dialogueBoost"),
    control: toggle,
  },
  {
    id: "volumeLeveling",
    page: "subtitles",
    title: "Even out volume",
    caption: "Night mode: quieter explosions, louder whispers",
    keywords: "night mode loudness normalize compression leveling",
    bind: p("volumeLeveling"),
    control: toggle,
  },
  { id: "subtitleStyle", page: "subtitles", title: "Subtitle Style", keywords: "captions appearance" },
  { id: "subtitleDelay", page: "subtitles", title: "Delay", keywords: "subtitle sync offset timing" },
  { id: "subtitleFont", page: "subtitles", title: "Font", keywords: "subtitle typeface family opendyslexic dyslexia dyslexic accessibility" },
  { id: "subtitleSize", page: "subtitles", title: "Size", keywords: "subtitle text font" },
  { id: "subtitlePosition", page: "subtitles", title: "Position", keywords: "subtitle raise height" },
  { id: "subtitleColor", page: "subtitles", title: "Color", keywords: "subtitle colour text" },
  { id: "subtitleOpacity", page: "subtitles", title: "Opacity", keywords: "subtitle transparency" },
  { id: "subtitleOutline", page: "subtitles", title: "Outline", keywords: "subtitle edge stroke shadow" },
  { id: "subtitleBackground", page: "subtitles", title: "Background", keywords: "subtitle box" },

  // Appearance
  { id: "accentColor", page: "appearance", title: "Accent colour", keywords: "color theme highlight" },
  {
    id: "theme",
    page: "appearance",
    title: "Background",
    keywords: "theme black oled dark",
    bind: s("theme", "dark"),
    control: choice([
      { value: "dark", label: "Dark" },
      { value: "black", label: "Black (OLED)" },
    ]),
  },
  { id: "uiScale", page: "appearance", title: "Interface size", keywords: "zoom scale bigger smaller text" },
  {
    id: "cardSize",
    page: "appearance",
    title: "Card size",
    caption: "Posters and thumbnails in rows and grids",
    keywords: "posters thumbnails bigger smaller",
    bind: s("cardSize", "medium"),
    control: choice([
      { value: "small", label: "Small" },
      { value: "medium", label: "Medium" },
      { value: "large", label: "Large" },
    ]),
  },
  {
    id: "uiFont",
    page: "appearance",
    title: "Font",
    keywords: "text typeface inter system opendyslexic dyslexia dyslexic accessibility readability",
    bind: s("uiFont", "inter"),
    control: choice([
      { value: "inter", label: "Inter" },
      { value: "system", label: "System" },
      { value: "opendyslexic", label: "OpenDyslexic" },
    ]),
  },
  {
    id: "reduceMotion",
    page: "appearance",
    title: "Reduce motion",
    caption: "Fades instead of slides and zooms, and no rotating carousel",
    keywords: "animations accessibility",
    bind: s("reduceMotion", "system"),
    control: choice([
      { value: "system", label: isMac ? "Match macOS" : "Match Windows" },
      { value: "on", label: "On" },
      { value: "off", label: "Off" },
    ]),
  },

  // Browsing
  { id: "startPage", page: "browsing", title: "Open the app on", keywords: "start page startup home library" },
  {
    id: "language",
    page: "browsing",
    title: "Titles and descriptions",
    caption: "The language of names, synopses and artwork",
    keywords: "metadata language tmdb",
    bind: s("language", "en-US"),
    control: choice((current) => metadataLanguageChoices(current)),
    // A new language rebuilds the catalog source; cached pages are in the old one.
    invalidates: [["catalog"], ["discover"], ["meta"], ["featured"], ["recommend"]],
  },
  {
    id: "trailerAutoplay",
    page: "browsing",
    title: "Play trailers on title pages",
    caption: "After a few seconds on a movie or show, its trailer plays behind the page",
    keywords: "trailer autoplay background video",
    bind: s("trailerAutoplay", true),
    control: toggle,
    tv: "Play Trailers on Title Pages",
  },
  {
    id: "trailerSound",
    page: "browsing",
    title: "Automatic trailer sound",
    caption: "When enabled, automatic trailer previews start with sound",
    keywords: "trailer muted audio volume with sound",
    bind: s("trailerSound", false),
    control: toggle,
    tv: "Automatic Trailer Sound",
  },
  {
    id: "showCalendar",
    page: "browsing",
    title: "Show the Calendar",
    caption: "A section listing new episodes of your shows by the day they air",
    keywords: "calendar upcoming episodes schedule air dates new",
    bind: s("showCalendar", false),
    control: toggle,
    tv: "Calendar",
  },
  {
    id: "heroAutoplay",
    page: "browsing",
    title: "Rotate the featured titles",
    caption: "Move to the next featured title every few seconds",
    keywords: "carousel hero autoplay",
    bind: s("heroAutoplay", true),
    control: toggle,
  },
  {
    id: "showContinueWatching",
    page: "browsing",
    title: "Show Continue Watching",
    keywords: "home row",
    bind: s("showContinueWatching", true),
    control: toggle,
    tv: "Continue Watching",
  },
  {
    id: "hideEpisodeThumbs",
    page: "browsing",
    title: "Blur unwatched episode pictures",
    caption: "A still can give away who's in the episode, or what happens",
    keywords: "spoilers thumbnails stills",
    bind: s("hideEpisodeThumbs", false),
    control: toggle,
  },
  {
    id: "hideEpisodeDescriptions",
    page: "browsing",
    title: "Hide unwatched episode descriptions",
    keywords: "spoilers synopsis summary",
    bind: s("hideEpisodeDescriptions", false),
    control: toggle,
  },
  {
    id: "matureContent",
    page: "browsing",
    title: "Mature content",
    caption: "Ecchi anime: fan service, suggestive art. Explicit titles never show",
    keywords: "nsfw ecchi family friendly kids blur hide adult",
    bind: p("matureContent"),
    control: choice([
      { value: "show", label: "Show" },
      { value: "blur", label: "Blur posters" },
      { value: "hide", label: "Hide" },
    ]),
    tv: "Mature Anime",
  },
  {
    id: "searchSuggestions",
    page: "browsing",
    title: "Suggest genres",
    caption: "A few genres under the search field before you type",
    keywords: "search suggestions genres dropdown",
    bind: p("searchSuggestions"),
    control: toggle,
  },
  {
    id: "saveRecentSearches",
    page: "browsing",
    title: "Remember recent searches",
    keywords: "history privacy",
    bind: p("saveRecentSearches"),
    control: toggle,
  },
  { id: "showCardTitles", page: "browsing", title: "Show titles", keywords: "cards names", bind: s("showCardTitles", true), control: toggle },
  { id: "showCardDetails", page: "browsing", title: "Show details", keywords: "cards year" },
  {
    id: "showCardRatings",
    page: "browsing",
    title: "Show IMDb ratings",
    caption: "Add an IMDb rating badge to each poster",
    keywords: "cards rating score badge imdb posters",
    bind: s("showCardRatings", false),
    control: toggle,
    tv: "IMDb Ratings on Cards",
  },
  {
    id: "cardRatingPosition",
    page: "browsing",
    title: "Rating position",
    keywords: "imdb badge on poster under corner overlay",
    bind: s("cardRatingPosition", "poster"),
    control: choice([
      { value: "poster", label: "On the poster" },
      { value: "below", label: "Under the poster" },
    ]),
    tv: "Rating Position",
  },
  {
    id: "ratingColors",
    page: "browsing",
    title: "Colour-code IMDb ratings",
    caption: "Green from 7, amber from 5, red below. Off: every score in IMDb yellow",
    keywords: "color colour rating score badge imdb yellow green red",
    bind: s("ratingColors", false),
    control: toggle,
  },
  {
    id: "episodeLayout",
    page: "browsing",
    title: "Default layout",
    controlLabel: "Episode layout",
    keywords: "episodes list grid",
    bind: s("episodeLayout", "row"),
    control: choice([
      { value: "row", label: "Row" },
      { value: "list", label: "List" },
    ]),
  },

  // Anime
  {
    id: "animeEnabled",
    page: "anime",
    title: "Show Anime",
    caption: "The Anime section, in desktop and TV mode",
    keywords: "anime section tab hide remove turn off disable",
    bind: p("animeEnabled"),
    control: toggle,
    tv: "Show Anime",
  },
  {
    id: "animeTitles",
    page: "anime",
    title: "Anime titles",
    caption: "Tower of Glass, Garasu no Tou, or ガラスの塔. Episode titles follow when they can",
    keywords: "anime romaji english japanese native names language",
    bind: p("animeTitles"),
    control: choice([
      { value: "english", label: "English" },
      { value: "romaji", label: "Romaji" },
      { value: "native", label: "Japanese" },
    ]),
    tv: "Titles",
  },
  {
    id: "animeVoices",
    page: "anime",
    title: "Voice actors",
    caption: "Whose voices to list beside the characters",
    keywords: "anime dub sub seiyuu japanese english characters",
    bind: p("animeVoices"),
    control: choice([
      { value: "japanese", label: "Japanese" },
      { value: "english", label: "English" },
    ]),
  },
  {
    id: "animeShelves",
    page: "anime",
    title: "Shelves",
    keywords: "anime rows featured carousel airing today season trending upcoming top rated popular movies genres",
  },
  {
    id: "animeCardScores",
    page: "anime",
    title: "Show scores",
    caption: "The AniList score on each poster",
    keywords: "anime anilist rating badge cards posters",
    bind: p("animeCardScores"),
    control: toggle,
    tv: "Scores",
  },
  {
    id: "animeScoreFormat",
    page: "anime",
    title: "Score format",
    keywords: "anime anilist rating percent out of ten",
    bind: p("animeScoreFormat"),
    control: choice([
      { value: "ten", label: "Out of ten (8.6)" },
      { value: "percent", label: "Percentage (86%)" },
    ]),
    tv: "Score Format",
  },
  {
    id: "animeCardCountdown",
    page: "anime",
    title: "Show airing countdowns",
    caption: "When the next episode lands, on shows that are on air",
    keywords: "anime next episode timer cards posters",
    bind: p("animeCardCountdown"),
    control: toggle,
    tv: "Airing Countdowns",
  },
  {
    id: "animeScheduleAll",
    page: "anime",
    title: "List every show",
    caption: "Include the shorts and regional shows most people aren't following",
    keywords: "anime schedule shorts regional all",
    bind: p("animeScheduleAll"),
    control: toggle,
  },
  {
    id: "animeSkipFiller",
    page: "anime",
    title: "Skip filler episodes",
    caption: "Next Episode and autoplay pass over episodes marked as filler. They stay in the list, marked Filler",
    keywords: "anime filler canon skip hide",
    bind: p("animeSkipFiller"),
    control: toggle,
  },
  {
    id: "animeHideRecaps",
    page: "anime",
    title: "Hide recap episodes",
    caption: "Leave episodes MyAnimeList marks as recaps out of the list",
    keywords: "anime recap skip",
    bind: p("animeHideRecaps"),
    control: toggle,
  },
  {
    id: "animeNo4k",
    page: "anime",
    title: "Hide 4K sources",
    caption: "Anime is almost never made in 4K: nearly all of those releases are AI upscales of the 1080p master",
    keywords: "anime 4k 2160p upscale ai sources quality",
    bind: p("animeNo4k"),
    control: toggle,
  },
  {
    id: "animePreferredGroups",
    page: "anime",
    title: "Preferred Release Groups",
    keywords: "anime release group preferred favourite favorite sources top priority",
  },
  {
    id: "animeSpoilerTags",
    page: "anime",
    title: "Show spoiler tags",
    caption: "Tags that give away the story, on an anime's Details",
    keywords: "anime tags spoilers anilist",
    bind: p("animeSpoilerTags"),
    control: toggle,
  },

  // Controls & TV
  { id: "tvMode", page: "controls", title: "TV mode", keywords: "couch fullscreen remote" },
  {
    id: "showTvButton",
    page: "controls",
    title: "TV mode button in the top bar",
    caption: "Off hides it; TV mode stays one click away here",
    keywords: "tv navbar hide show button icon",
    bind: p("showTvButton"),
    control: toggle,
  },
  {
    id: "uiSounds",
    page: "controls",
    title: "Interface sounds",
    caption: "Soft clicks as you move, select and go back",
    keywords: "audio clicks",
    bind: p("uiSounds"),
    control: toggle,
    tv: "Interface Sounds",
  },
  {
    id: "uiSoundPack",
    page: "controls",
    title: "Sound pack",
    keywords: "interface sounds",
    bind: p("uiSoundPack"),
    control: choice([
      { value: "ambient", label: "Ambient" },
      { value: "soft", label: "Soft tap" },
      { value: "wood", label: "Wood" },
      { value: "glass", label: "Glass" },
      { value: "pluck", label: "Pluck" },
      { value: "classic", label: "Classic" },
    ]),
  },
  {
    id: "uiSoundVolume",
    page: "controls",
    title: "Sound volume",
    keywords: "interface sounds loudness",
    bind: p("uiSoundVolume"),
    control: { kind: "number", min: 5, max: 100, step: 5, unit: "%", scale: 100, tvStep: 10 },
    tv: "Sound Volume",
  },
  { id: "shortcuts", page: "controls", title: "Keyboard Shortcuts", keywords: "keybinds hotkeys keys" },

  // Controller
  {
    id: "controllerAlerts",
    page: "controller",
    title: "Connection notices",
    caption: "When a controller connects or disconnects",
    keywords: "controller gamepad toast",
    bind: p("controllerAlerts"),
    control: toggle,
    tv: "Controller Notices",
  },
  {
    id: "suggestTvMode",
    page: "controller",
    title: "Suggest TV mode",
    caption: "Offer TV mode when a controller connects in desktop mode",
    keywords: "controller gamepad",
    bind: p("suggestTvMode"),
    control: toggle,
  },
  {
    id: "padLabels",
    page: "controller",
    title: "Button labels",
    caption: "The letters or shapes shown for each button",
    keywords: "controller gamepad xbox playstation nintendo glyphs icons",
    bind: p("padLabels"),
    control: choice([
      { value: "auto", label: "Match the controller" },
      { value: "xbox", label: "Xbox" },
      { value: "playstation", label: "PlayStation" },
      { value: "nintendo", label: "Nintendo" },
    ]),
  },
  {
    id: "padHints",
    page: "controller",
    title: "Button hints",
    caption: "What each button does, along the bottom of TV mode",
    keywords: "controller gamepad bottom bar help",
    bind: p("padHints"),
    control: toggle,
    tv: "Button Hints",
  },
  {
    id: "padStick",
    page: "controller",
    title: "Left stick moves too",
    caption: "Use the stick like the D-pad",
    keywords: "controller gamepad analog thumbstick navigation",
    bind: p("padStick"),
    control: toggle,
    tv: "Move With the Left Stick",
  },
  {
    id: "padStickSensitivity",
    page: "controller",
    title: "Stick sensitivity",
    caption: "How far to tilt it before it moves",
    keywords: "controller gamepad analog deadzone",
    bind: p("padStickSensitivity"),
    control: choice([
      { value: "low", label: "Low (tilt further)" },
      { value: "normal", label: "Normal" },
      { value: "high", label: "High (a light touch)" },
    ]),
  },
  {
    id: "padRepeat",
    page: "controller",
    title: "Repeat speed",
    caption: "How fast a held direction keeps moving",
    keywords: "controller gamepad dpad d-pad hold scroll fast",
    bind: p("padRepeat"),
    control: choice([
      { value: "slow", label: "Slow" },
      { value: "normal", label: "Normal" },
      { value: "fast", label: "Fast" },
    ]),
  },
  { id: "padNav", page: "controller", title: "Buttons while browsing", keywords: "controller gamepad buttons remap bindings dpad d-pad" },
  { id: "padPlayer", page: "controller", title: "Buttons in the player", keywords: "controller gamepad buttons remap bindings" },
  {
    id: "padPlayerVolume",
    page: "controller",
    title: "Up and down change the volume",
    caption: "In the player. Off: leave the volume to your TV or speakers",
    keywords: "controller gamepad dpad d-pad player",
    bind: p("padPlayerVolume"),
    control: toggle,
    tv: "Up and Down Change Volume in the Player",
  },

  // Add-ons
  { id: "addonsInstalled", page: "addons", title: "Installed", keywords: "add-ons addons remove" },
  { id: "addonUrl", page: "addons", title: "Install from URL", keywords: "add-on addon manifest stremio" },

  // Marketplace
  { id: "openSubtitles", page: "marketplace", title: "OpenSubtitles", keywords: "add-ons addons subtitles captions install store" },
  { id: "marketplace", page: "marketplace", title: "Search add-ons", keywords: "add-on marketplace addons store browse install plugins" },

  // Services
  { id: "tmdbKey", page: "services", title: "Artwork and episode info", keywords: "tmdb api key metadata posters" },
  {
    id: "ratingsKeys",
    page: "services",
    title: "Critic and audience scores",
    keywords: "rotten tomatoes metacritic letterboxd trakt mdblist omdb ratings reviews",
  },
  { id: "seekrKey", page: "services", title: "Timeline previews", keywords: "seekr thumbnails scrubbing" },

  // Advanced
  {
    id: "hwdec",
    page: "advanced",
    title: "Hardware decoding",
    caption: "Lets the graphics card decode video. Turn off only if you see green frames, glitches or a black picture.",
    keywords: "gpu hwdec green glitches black",
    bind: p("hwdec"),
    control: toggle,
  },
  {
    id: "deband",
    page: "advanced",
    title: "Smooth colour banding",
    caption: "Removes visible steps in dark scenes and skies, at a small cost in GPU power",
    keywords: "deband gradients color",
    bind: p("deband"),
    control: toggle,
  },
  {
    id: "autocrop",
    page: "advanced",
    title: "Crop black bars",
    caption:
      "Some files carry black bars inside the picture. This finds and trims them so the film fills a wide or ultrawide screen. Uses a little more CPU.",
    keywords: "autocrop crop letterbox black bars ultrawide 21:9 aspect",
    bind: p("autocrop"),
    control: toggle,
    tv: "Crop Black Bars",
  },
  {
    id: "buffer",
    page: "advanced",
    title: "Buffer",
    caption: "How far ahead to load. Larger rides out a patchy connection but uses more memory.",
    keywords: "cache read ahead memory stutter",
    bind: p("buffer"),
    control: choice([
      { value: "small", label: "Small (30 s)" },
      { value: "normal", label: "Normal (90 s)" },
      { value: "large", label: "Large (5 min)" },
    ]),
  },
  { id: "resetSettings", page: "advanced", title: "Reset all settings", keywords: "defaults restore" },

  // About & Updates
  { id: "version", page: "about", title: "Version", keywords: "about build number" },
  { id: "softwareUpdate", page: "about", title: "Software update", keywords: "check for updates upgrade new version install" },
  {
    id: "autoDownloadUpdates",
    page: "about",
    title: "Download updates automatically",
    caption: "New versions download in the background. Nothing installs until you restart.",
    keywords: "auto update background",
    bind: p("autoDownloadUpdates"),
    control: toggle,
  },
  { id: "releaseNotes", page: "about", title: "Release notes", keywords: "changelog what's new" },
  { id: "credits", page: "about", title: "Data sources", keywords: "credits attribution tmdb anilist thetvdb licence" },
  { id: "animeCache", page: "about", title: "Anime data", keywords: "cache clear filler recap anime-lists ids storage disk" },
];

const BY_ID = new Map(SETTINGS.map((d) => [d.id, d]));

/** The entry with this id; throws on a typo, so a wrong id fails at once rather than drawing nothing. */
export function settingDef(id: string): SettingDef {
  const def = BY_ID.get(id);
  if (!def) throw new Error(`No setting "${id}" in lib/settings/schema.ts`);
  return def;
}

/** A choice control's options for the current value. */
export const choicesOf = (control: Extract<Control, { kind: "choice" }>, current: Value) =>
  typeof control.choices === "function" ? control.choices(current) : control.choices;

/**
 * The value a row shows: the stored one, or the fallback when it's missing. A choice setting
 * whose stored value is no longer offered (an old sort, a removed resolution) shows the fallback.
 */
export function readSetting(def: SettingDef, settings: Settings, prefs: Prefs): Value {
  if (!def.bind) throw new Error(`Setting "${def.id}" has no bind`);
  if (def.bind.store === "prefs") return prefs[def.bind.key] as Value;
  const raw = settings[def.bind.key] as Value | null | undefined;
  const value = raw ?? def.bind.fallback;
  if (def.control?.kind === "choice" && !choicesOf(def.control, value).some((c) => c.value === value)) return def.bind.fallback;
  return value;
}

/** The patch that stores `value` for this setting, in its store. */
export function patchFor(def: SettingDef, value: Value): { settings?: Partial<Settings>; prefs?: Partial<Prefs> } {
  if (!def.bind) throw new Error(`Setting "${def.id}" has no bind`);
  return def.bind.store === "prefs" ? { prefs: { [def.bind.key]: value } } : { settings: { [def.bind.key]: value } };
}

/** A number control's value as shown (scaled), and back. */
export const shownNumber = (control: Extract<Control, { kind: "number" }>, stored: number) =>
  Math.round(stored * (control.scale ?? 1) * 100) / 100;
export const storedNumber = (control: Extract<Control, { kind: "number" }>, shown: number) => shown / (control.scale ?? 1);

/** How TV names a number. */
export function numberLabel(control: Extract<Control, { kind: "number" }>, n: number) {
  if (control.label) return control.label(n);
  if (n === 0 && control.zero) return control.zero;
  if (control.unit === "%") return `${n}%`;
  return control.unit ? `${n} ${control.unit}` : String(n);
}

/**
 * The values TV steps through for a number (shown units): the minimum, then every multiple of the
 * TV step up to the maximum, plus the current value if it falls between them (set on desktop).
 */
export function tvNumberSteps(control: Extract<Control, { kind: "number" }>, current: number): number[] {
  const step = control.tvStep ?? control.step ?? 1;
  const out = new Set<number>([control.min]);
  for (let n = Math.ceil(control.min / step) * step; n <= control.max + 1e-9; n += step) out.add(Math.round(n * 100) / 100);
  if (current >= control.min && current <= control.max) out.add(current);
  return [...out].sort((a, b) => a - b);
}
