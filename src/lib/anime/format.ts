import { usePrefs } from "../prefs";
import type { AnimeCard, AnimeTitle, FuzzyDate, MediaFormat, MediaSeason, MediaStatus, RelationType } from "./anilist";

/** The title in the language from Settings → Anime, falling back sensibly. */
export function pickTitle(t: AnimeTitle, lang: "romaji" | "english" | "native") {
  if (lang === "english") return t.english ?? t.romaji ?? t.native ?? "";
  if (lang === "native") return t.native ?? t.romaji ?? t.english ?? "";
  return t.romaji ?? t.english ?? t.native ?? "";
}

export function useAnimeTitle() {
  const { animeTitles } = usePrefs();
  return (t: AnimeTitle) => pickTitle(t, animeTitles);
}

/** Fan service: AniList's Ecchi genre (its adult titles are never asked for). */
export const isMature = (a: { genres?: string[] | null }) => !!a.genres?.includes("Ecchi");

export const FORMAT_LABEL: Record<MediaFormat, string> = {
  TV: "TV",
  TV_SHORT: "TV Short",
  MOVIE: "Movie",
  SPECIAL: "Special",
  OVA: "OVA",
  ONA: "ONA",
  MUSIC: "Music",
  MANGA: "Manga",
  NOVEL: "Light Novel",
  ONE_SHOT: "One Shot",
};

export const STATUS_LABEL: Record<MediaStatus, string> = {
  FINISHED: "Finished",
  RELEASING: "Airing",
  NOT_YET_RELEASED: "Not Yet Aired",
  CANCELLED: "Cancelled",
  HIATUS: "On Hiatus",
};

export const SEASON_LABEL: Record<MediaSeason, string> = { WINTER: "Winter", SPRING: "Spring", SUMMER: "Summer", FALL: "Fall" };

export const RELATION_LABEL: Record<RelationType, string> = {
  PREQUEL: "Prequel",
  SEQUEL: "Sequel",
  PARENT: "Main Story",
  SIDE_STORY: "Side Story",
  SPIN_OFF: "Spin-off",
  ALTERNATIVE: "Alternative",
  SUMMARY: "Recap",
  ADAPTATION: "Adaptation",
  SOURCE: "Source",
  CHARACTER: "Shares Characters",
  COMPILATION: "Compilation",
  CONTAINS: "Contains",
  OTHER: "Related",
};

export const SOURCE_LABEL: Record<string, string> = {
  ORIGINAL: "Original",
  MANGA: "Manga",
  LIGHT_NOVEL: "Light Novel",
  VISUAL_NOVEL: "Visual Novel",
  VIDEO_GAME: "Video Game",
  NOVEL: "Novel",
  WEB_NOVEL: "Web Novel",
  WEB_MANGA: "Web Manga",
  ONE_SHOT: "One Shot",
  DOUJINSHI: "Doujinshi",
  ANIME: "Anime",
  LIVE_ACTION: "Live Action",
  GAME: "Game",
  COMIC: "Comic",
  MULTIMEDIA_PROJECT: "Multimedia Project",
  PICTURE_BOOK: "Picture Book",
  OTHER: "Other",
};

/** "3d 4h", "5h 12m", "18m": how long until something airs. */
export function countdown(seconds: number) {
  if (seconds <= 0) return "now";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${Math.max(1, m)}m`;
}

/** Seconds until an airing, from its unix time (so it stays right as the page sits open). */
export const untilAiring = (airingAt: number) => airingAt - Math.floor(Date.now() / 1000);

export function fuzzyDate(d?: FuzzyDate | null) {
  if (!d?.year) return undefined;
  if (!d.month) return String(d.year);
  return new Date(d.year, d.month - 1, d.day ?? 1).toLocaleDateString(undefined, {
    month: "short",
    day: d.day ? "numeric" : undefined,
    year: "numeric",
  });
}

/** AniList descriptions carry a little HTML and a "(Source: …)" line; plain paragraphs out. */
export function cleanDescription(html?: string | null) {
  if (!html) return [];
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(i|b|em|strong|a)[^>]*>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&mdash;/g, "—")
    .replace(/\(Source:[^)]*\)/gi, "")
    .replace(/\[Written by MAL Rewrite\]/gi, "")
    .replace(/Note:.*$/is, "");
  return text
    .split(/\n\s*\n|\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/** "TV · 2023 · 23 eps" for a card's caption. */
export function cardFacts(a: AnimeCard) {
  return [
    a.format ? FORMAT_LABEL[a.format] : undefined,
    a.seasonYear ?? a.startDate?.year ?? undefined,
    a.format === "MOVIE" ? (a.duration ? `${a.duration} min` : undefined) : a.episodes ? `${a.episodes} eps` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** AniList's 0–100 score as the 0–10 people expect. */
const score10 = (n?: number | null) => (n ? (n / 10).toFixed(1) : undefined);

/** A score the way Settings → Anime asks for it: 8.6 or 86%. */
export function formatScore(n: number | null | undefined, format: "ten" | "percent") {
  if (!n) return undefined;
  return format === "percent" ? `${n}%` : score10(n);
}

export function useAnimeScore() {
  const { animeScoreFormat } = usePrefs();
  return (n?: number | null) => formatScore(n, animeScoreFormat);
}
