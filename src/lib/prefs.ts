import { useSyncExternalStore } from "react";
import type { SoundPack } from "../tv/sounds";
import { settingsChanged } from "./settingsChanges";

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

  // This machine's screen, speakers and GPU:
  /** Interface zoom, 1 = 100%. */
  uiScale: number;
  /** Pause when the window is minimized. */
  pauseOnMinimize: boolean;
  /** mpv: louder dialogue when surround is folded down to stereo. */
  dialogueBoost: boolean;
  /** mpv: even out loud and quiet scenes. */
  volumeLeveling: boolean;
  /** mpv: hardware decoding. */
  hwdec: boolean;
  /** mpv: smooth colour banding. */
  deband: boolean;
  /** mpv read-ahead. */
  buffer: "small" | "normal" | "large";
  /** Keep the last few searches. */
  saveRecentSearches: boolean;
  /** Genres under the empty search field. */
  searchSuggestions: boolean;
  /** Fetch new versions in the background; installing still waits for a restart. */
  autoDownloadUpdates: boolean;
  /** The TV mode button in the navbar (Settings → Controls & TV). */
  showTvButton: boolean;

  // Anime:
  /** The Anime section at all: off removes its tab in desktop and TV mode. */
  animeEnabled: boolean;
  /** Comma-separated shelves left off the Anime page (lib/anime/shelves.ts). */
  animeHiddenShelves: string;
  /** The AniList score on anime posters. */
  animeCardScores: boolean;
  /** "Ep 5 in 2d" on posters of shows on air. */
  animeCardCountdown: boolean;
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
}

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
  uiScale: 1,
  pauseOnMinimize: false,
  dialogueBoost: false,
  volumeLeveling: false,
  hwdec: true,
  deband: false,
  buffer: "normal",
  saveRecentSearches: true,
  searchSuggestions: true,
  autoDownloadUpdates: true,
  showTvButton: true,
  animeEnabled: true,
  animeHiddenShelves: "",
  animeCardScores: true,
  animeCardCountdown: true,
  animeScoreFormat: "ten",
  animeScheduleAll: false,
  animeHideRecaps: false,
  animeTitles: "english",
  animeVoices: "japanese",
  animeSkipFiller: false,
  animeSpoilerTags: false,
};

const STORAGE = "polar.prefs";

let prefs: Prefs = (() => {
  try {
    return { ...DEFAULTS, ...(JSON.parse(localStorage.getItem(STORAGE) ?? "{}") as Partial<Prefs>) };
  } catch {
    return { ...DEFAULTS };
  }
})();
const listeners = new Set<() => void>();

export const getPrefs = () => prefs;

/** The ones that follow the profile rather than the machine (account/settingsSync.ts). */
export const SYNCED_PREFS = [
  "preferFileChapters",
  "saveRecentSearches",
  "searchSuggestions",
  "animeEnabled",
  "animeHiddenShelves",
  "animeCardScores",
  "animeCardCountdown",
  "animeScoreFormat",
  "animeScheduleAll",
  "animeHideRecaps",
  "animeTitles",
  "animeVoices",
  "animeSkipFiller",
  "animeSpoilerTags",
] as const satisfies readonly (keyof Prefs)[];

export function setPrefs(patch: Partial<Prefs>, { quiet = false } = {}) {
  prefs = { ...prefs, ...patch };
  localStorage.setItem(STORAGE, JSON.stringify(prefs));
  listeners.forEach((l) => l());
  if (!quiet && SYNCED_PREFS.some((k) => k in patch)) settingsChanged();
}

export const resetPrefs = () => setPrefs(DEFAULTS);

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
