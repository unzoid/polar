import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../api";
import { isKitsuId } from "../anime/kitsu";
import { useIsAnime, useSettings } from "../net/queries";
import { keys } from "../net/queryKeys";
import type { ContentType, Settings } from "../types";
import { langMatches, ORIGINAL_LANGUAGE, SAME_AS_OTHERS } from "./languages";

/** What an anime was made in when its details don't say: nearly always Japanese. */
const ANIME_ORIGINAL = "ja";

export interface TitleLanguages {
  /** Preferred audio language; empty = the file's default. */
  audio: string;
  /** Preferred subtitle language; empty = off. */
  subtitle: string;
}

/** An anime setting's value, with "Same as other titles" (or none yet) and "Original language" worked out. */
function own(value: string | undefined, others: string, original: string | undefined) {
  if (value === undefined || value === SAME_AS_OTHERS) return others;
  return value === ORIGINAL_LANGUAGE ? original || ANIME_ORIGINAL : value;
}

/**
 * The audio and subtitle language a title plays with: Settings → Anime's own
 * for an anime, Subtitles & Audio's for everything else (#235). `original`: the
 * language the title was made in, when its details say.
 */
export function titleLanguages(settings: Settings | undefined, anime: boolean, original?: string): TitleLanguages {
  const audio = settings?.audioLanguage ?? "";
  const subtitle = settings?.subtitleLanguage ?? "";
  if (!anime) return { audio, subtitle };
  return { audio: own(settings?.animeAudioLanguage, audio, original), subtitle: own(settings?.animeSubtitleLanguage, subtitle, original) };
}

/**
 * The settings as one title sees them: its own languages in `audioLanguage`
 * and `subtitleLanguage`, so the source list, auto-pick and Best Match need
 * nothing else to follow them.
 */
export function settingsForTitle(settings: Settings | undefined, anime: boolean, original?: string): Settings | undefined {
  if (!settings || !anime) return settings;
  const { audio, subtitle } = titleLanguages(settings, anime, original);
  return { ...settings, audioLanguage: audio, subtitleLanguage: subtitle };
}

/**
 * Where the player keeps a language you pick a track in: Subtitles & Audio's
 * setting, or for an anime, Settings → Anime's while it has one of its own.
 * Picking the original language again leaves "Original language" as it is.
 */
export function rememberLanguage(
  settings: Settings | undefined,
  anime: boolean,
  original: string | undefined,
  patch: { audioLanguage?: string; subtitleLanguage?: string },
): Partial<Settings> {
  if (!anime) return patch;
  const out: Partial<Settings> = {};
  const keep = (lang: string, value: string | undefined, others: "audioLanguage" | "subtitleLanguage", ownKey: "animeAudioLanguage" | "animeSubtitleLanguage") => {
    if (value === undefined || value === SAME_AS_OTHERS) out[others] = lang;
    else if (value === ORIGINAL_LANGUAGE && lang && langMatches(lang, original || ANIME_ORIGINAL)) return;
    else out[ownKey] = lang;
  };
  if (patch.audioLanguage !== undefined) keep(patch.audioLanguage, settings?.animeAudioLanguage, "audioLanguage", "animeAudioLanguage");
  if (patch.subtitleLanguage !== undefined) keep(patch.subtitleLanguage, settings?.animeSubtitleLanguage, "subtitleLanguage", "animeSubtitleLanguage");
  return out;
}

/** The title a video belongs to: `tt1:2:3` → `tt1`, `kitsu:5:3` → `kitsu:5`. */
export function titleIdOf(videoId: string) {
  const parts = videoId.split(":");
  return isKitsuId(videoId) ? parts.slice(0, 2).join(":") : parts[0];
}

/**
 * Settings for one video's title (see settingsForTitle), whether it's anime
 * decided as everywhere else (useIsAnime). The original language comes from
 * the title's details when they're already loaded; this never fetches them.
 */
export function useTitleSettings(type: ContentType, videoId: string | undefined) {
  const { data: settings } = useSettings();
  const anime = useIsAnime(videoId);
  const titleId = videoId ? titleIdOf(videoId) : "";
  const { data: meta } = useQuery({
    queryKey: keys.meta(type, titleId),
    queryFn: () => api.meta(type, titleId),
    enabled: false,
    staleTime: 60 * 60_000,
  });
  const original = meta?.details?.originalLanguage;
  const forTitle = useMemo(() => settingsForTitle(settings, anime, original), [settings, anime, original]);
  return { settings: forTitle, anime, original };
}
