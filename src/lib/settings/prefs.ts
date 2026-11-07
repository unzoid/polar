import { storeLocal } from "../errors";
import { useSyncExternalStore } from "react";
import { isRecord, likeTemplate, storedJson } from "../parse";
import { settingsChanged } from "./changes";

/** TV mode's interface sound packs (tv/sounds.ts renders them). */
export type SoundPack = "ambient" | "soft" | "wood" | "glass" | "pluck" | "classic";

/**
 * Preferences that only the interface reads (TV sounds, controller alerts),
 * kept in localStorage. Most describe this machine and its controllers, so
 * they stay on it; the few in SYNCED_PREFS follow the profile.
 */
export interface Prefs {
  /** Interface sounds in TV mode. */
  uiSounds: boolean;
  /** 0..1. */
  uiSoundVolume: number;
  /** Which set of interface sounds to play. */
  uiSoundPack: SoundPack;
  /** A notice when a controller connects or disconnects. */
  controllerAlerts: boolean;
  /** In desktop mode, offer TV mode when a controller connects. */
  suggestTvMode: boolean;
  /** Whose button labels to show: the controller in use ("auto"), or always one maker's. */
  padLabels: "auto" | "xbox" | "playstation" | "nintendo";
  /** The strip of button hints along the bottom of TV mode. */
  padHints: boolean;
  /** The left stick moves around (and seeks in the player), like the D-pad. */
  padStick: boolean;
  /** How far the stick has to tilt before it counts. */
  padStickSensitivity: "low" | "normal" | "high";
  /** How quickly a held direction repeats. */
  padRepeat: "slow" | "normal" | "fast";
  /** In the player, up and down change the volume. Off: they do nothing (keeps the TV's own volume in charge). */
  padPlayerVolume: boolean;
  /** Take intro, recap and credits from the file's own chapters before IntroDB. */
  preferFileChapters: boolean;
  /** Seconds the Skip button counts down before an automatic intro or recap skip; 0 = skip at once. */
  autoSkipDelay: number;

  // This machine's screen, speakers and GPU:
  /** Interface zoom, 1 = 100%. */
  uiScale: number;
  /** Pause when the window is minimized. */
  pauseOnMinimize: boolean;
  /** What the user's Discord profile shows while something plays: nothing, that Polarity is in use, or the title. */
  discordPresence: "off" | "app" | "title";
  /**
   * A profile new to this device starts with the add-ons and API keys already here (#80). Off: it starts
   * with none (its own from the account, once they sync) and Settings offers to copy a set from this device.
   */
  shareAddonsAndKeys: boolean;
  /** mpv: louder dialogue when surround is folded down to stereo. */
  dialogueBoost: boolean;
  /** mpv: even out loud and quiet scenes. */
  volumeLeveling: boolean;
  /** mpv: hardware decoding. */
  hwdec: boolean;
  /** mpv: smooth colour banding. */
  deband: boolean;
  /** mpv: crop black bars burnt into the picture, so it fills wide screens. */
  autocrop: boolean;
  /** mpv, with autocrop: read ahead so a change of bars lands on the cut. */
  autocropLookahead: boolean;
  /** mpv, with autocrop, Windows, Linux and Android: our detector reads every frame (macOS and iOS always do). */
  autocropEveryFrame: boolean;
  /** Phones and tablets: the picture fills the screen, its edges cropped, instead of fitting inside it (#149). */
  videoFill: boolean;
  /** TV mode, paused: Left and Right step one frame instead of skipping (the player's Speed options, #243). */
  tvFrameStep: boolean;
  /** mpv read-ahead. */
  buffer: "small" | "normal" | "large";
  /** Torrent sources: most GB their cache on this device may hold; 0 = no limit. */
  torrentCacheGb: number;
  /** Torrent sources: download cap in Mbit/s; 0 = none. (Before #137 it capped upload too.) */
  torrentSpeedMbps: number;
  /** Torrent sources: upload cap in Mbit/s; 0 = none. */
  torrentUploadMbps: number;
  /** Torrent sources: explain torrent playback before the next one plays (Play in that notice turns it off). */
  torrentNotice: boolean;
  /** Torrent sources: keep sharing what was played until the app quits. Off: stop and delete it when playback ends. */
  torrentKeepSharing: boolean;
  /** Keep the last few searches. */
  saveRecentSearches: boolean;
  /** Genres under the empty search field. */
  searchSuggestions: boolean;
  /** Fetch new versions in the background; installing still waits for a restart. */
  autoDownloadUpdates: boolean;
  /** The TV mode button in the navbar (Settings → Controls & TV). */
  showTvButton: boolean;

  // Notifications (#209), on this device: each kind off until switched on (phones ask for permission then).
  /** A series being followed has a new episode out. */
  notifyEpisodes: boolean;
  /** A series being followed has a new season out. */
  notifySeasons: boolean;
  /** A download finished or failed. */
  notifyDownloads: boolean;
  /** Which series count as followed: the library and what's been started, or only what's been started. */
  notifyScope: "library" | "started";

  /** Ecchi anime (AniList's adult titles never show): as is, blurred, or left out. Synced. */
  matureContent: "show" | "blur" | "hide";

  // Anime:
  /** The Anime section at all: off removes its tab in desktop and TV mode. */
  animeEnabled: boolean;
  /** Comma-separated shelves left off the Anime page (lib/anime/shelves.ts). */
  animeHiddenShelves: string;
  /** The AniList score on anime posters. */
  animeCardScores: boolean;
  /** "Ep 5 in 2d" on posters of shows on air. */
  animeCardCountdown: boolean;
  /** Each AniList entry (season, part, film) as its own card and page, not one per franchise. Display only (#22). */
  animeSeparateEntries: boolean;
  /** Where a manga, novel or other entry Polarity can't play opens from Also in This Franchise (#192). */
  animeReadOn: "myanimelist" | "anilist";
  /** Also in This Franchise leaves out what isn't an anime series or film Polarity can play (#192). */
  animeHideUnplayable: boolean;
  /** AniList scores out of ten (8.6) or as a percentage (86%). */
  animeScoreFormat: "ten" | "percent";
  /** The schedule lists everything airing, not just shows people are following. */
  animeScheduleAll: boolean;
  /** Leave recap episodes out of the episode list. */
  animeHideRecaps: boolean;
  /** Which title to show: "romaji" (Garasu no Tou), "english" (Tower of Glass) or "native" (ガラスの塔). */
  animeTitles: "romaji" | "english" | "native";
  /** Whose voices to list beside the characters. */
  animeVoices: "japanese" | "english";
  /** Autoplay and Next Episode pass over filler episodes. */
  animeSkipFiller: boolean;
  /** Show tags that give the story away. */
  animeSpoilerTags: boolean;
  /** Leave 4K sources out for anime: nearly all are AI upscales of a 1080p master. */
  animeNo4k: boolean;
  /** Release groups whose anime sources go to the top, comma-separated, most preferred first (lib/anime/groups.ts). */
  animePreferredGroups: string;
}

/**
 * Torrent sources' upload cap until the user changes it: 4 Mbit/s (500 KB/s). That's about what a
 * 1080p stream needs, so peers get back roughly what playback takes, and it stays under half of a
 * slow cable or DSL line's upload (10 Mbit/s and less), leaving room for the download's own traffic.
 */
export const TORRENT_UPLOAD_MBPS = 4;

const DEFAULTS: Prefs = {
  uiSounds: true,
  uiSoundVolume: 0.5,
  uiSoundPack: "classic",
  controllerAlerts: true,
  suggestTvMode: true,
  padLabels: "auto",
  padHints: true,
  padStick: true,
  padStickSensitivity: "normal",
  padRepeat: "normal",
  padPlayerVolume: true,
  preferFileChapters: true,
  autoSkipDelay: 5,
  uiScale: 1,
  pauseOnMinimize: false,
  discordPresence: "off",
  shareAddonsAndKeys: false,
  dialogueBoost: false,
  volumeLeveling: false,
  hwdec: true,
  deband: false,
  autocrop: false,
  autocropLookahead: true,
  autocropEveryFrame: false,
  videoFill: false,
  tvFrameStep: false,
  buffer: "normal",
  torrentCacheGb: 20,
  torrentSpeedMbps: 0,
  torrentUploadMbps: TORRENT_UPLOAD_MBPS,
  torrentNotice: true,
  torrentKeepSharing: false,
  saveRecentSearches: true,
  searchSuggestions: true,
  autoDownloadUpdates: true,
  showTvButton: true,
  notifyEpisodes: false,
  notifySeasons: false,
  notifyDownloads: false,
  notifyScope: "library",
  matureContent: "show",
  animeEnabled: true,
  animeHiddenShelves: "",
  animeCardScores: true,
  animeCardCountdown: true,
  animeSeparateEntries: false,
  animeReadOn: "myanimelist",
  animeHideUnplayable: false,
  animeScoreFormat: "ten",
  animeScheduleAll: false,
  animeHideRecaps: false,
  animeTitles: "english",
  animeVoices: "japanese",
  animeSkipFiller: false,
  animeSpoilerTags: false,
  animeNo4k: true,
  animePreferredGroups: "",
};

const STORAGE = "polar.prefs";

const stored = storedJson(localStorage, STORAGE);
/** Installs from before #80 (prefs or an account's settings stored already) keep sharing add-ons and keys. */
const earlier = (stored !== undefined || localStorage.getItem("polar.settingsOwner") !== null) && !(isRecord(stored) && "shareAddonsAndKeys" in stored);
let prefs: Prefs = { ...DEFAULTS, ...(earlier ? { shareAddonsAndKeys: true } : {}), ...earlierUpload(stored), ...readPrefs(stored) };
const listeners = new Set<() => void>();

export const getPrefs = () => prefs;

/** Before #137 the speed limit capped upload too: one set then keeps upload at most that low. */
function earlierUpload(stored: unknown): Partial<Prefs> {
  if (!isRecord(stored) || "torrentUploadMbps" in stored) return {};
  const speed = stored.torrentSpeedMbps;
  return typeof speed === "number" && speed > 0 ? { torrentUploadMbps: Math.min(speed, TORRENT_UPLOAD_MBPS) } : {};
}

/** Stored or synced prefs: the known ones, each of the kind its default is (critique M9). */
export function readPrefs(v: unknown): Partial<Prefs> {
  return likeTemplate(DEFAULTS, v);
}

/** The ones that follow the profile rather than the machine (account/settingsSync.ts). */
export const SYNCED_PREFS = [
  "preferFileChapters",
  "autoSkipDelay",
  "saveRecentSearches",
  "searchSuggestions",
  "matureContent",
  "animeEnabled",
  "animeHiddenShelves",
  "animeCardScores",
  "animeCardCountdown",
  "animeSeparateEntries",
  "animeReadOn",
  "animeHideUnplayable",
  "animeScoreFormat",
  "animeScheduleAll",
  "animeHideRecaps",
  "animeTitles",
  "animeVoices",
  "animeSkipFiller",
  "animeSpoilerTags",
  "animeNo4k",
  "animePreferredGroups",
] as const satisfies readonly (keyof Prefs)[];

export function setPrefs(patch: Partial<Prefs>, { quiet = false } = {}) {
  prefs = { ...prefs, ...patch };
  storeLocal(STORAGE, JSON.stringify(prefs));
  listeners.forEach((l) => l());
  if (!quiet && SYNCED_PREFS.some((k) => k in patch)) settingsChanged();
}

export const resetPrefs = () => setPrefs(DEFAULTS);

/** Every pref as it is until changed (settings sync sends only what differs). */
export const PREF_DEFAULTS: Readonly<Prefs> = DEFAULTS;

/** True once anything differs from the defaults. */
export const prefsCustomized = (p: Prefs) => (Object.keys(DEFAULTS) as (keyof Prefs)[]).some((k) => p[k] !== DEFAULTS[k]);

export function usePrefs() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => prefs,
  );
}
