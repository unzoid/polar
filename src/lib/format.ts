import type { Video } from "./types";

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** "1h 12m left" — remaining time reads better than a bare percentage. Nothing when the length isn't known. */
export function formatRemaining(position: number, duration: number) {
  if (!(duration > 0)) return "";
  // Rounded to whole minutes before splitting, so 59.5 minutes reads "1h 0m", never "60m".
  const total = Math.round(Math.max(0, duration - position) / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h) return `${h}h ${m}m left`;
  return `${Math.max(1, m)}m left`;
}

/** An addon's "142 min" as "2 hr 22 min"; other formats pass through. */
export function formatRuntime(runtime?: string) {
  return runtime?.replace(/(\d+) min/, (_, n) => {
    const minutes = Number(n);
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h ? `${h} hr ${m} min` : `${m} min`;
  });
}

export function episodeCode(season?: number, episode?: number) {
  if (season == null || episode == null) return "";
  return `S${season}, E${episode}`;
}

/** "49 min" → 2940 seconds; 0 when unknown. */
export const runtimeSeconds = (runtime?: string) => Number(runtime?.match(/(\d+)\s*min/)?.[1] ?? 0) * 60;

export function isReleased(video: Video) {
  return !video.released || new Date(video.released).getTime() <= Date.now();
}

/** How many days before its listed date an episode can already be opened (#143). */
export const EARLY_DAYS = 7;

/**
 * Can its sources be checked yet? Released, or listed for the coming week: streaming services often put an episode
 * out days before the TV air date the listings carry (#143). Up Next and watched counts still go by `isReleased`.
 */
export function isOpenable(video: Video) {
  return !video.released || new Date(video.released).getTime() <= Date.now() + EARLY_DAYS * 86_400_000;
}

/** The date line of an episode: its air date, "Airs …" when it may be out early, "Coming …" further ahead. */
export function airLabel(video: Video) {
  const date = formatDate(video.released);
  return isReleased(video) ? date : isOpenable(video) ? `Airs ${date}` : `Coming ${date}`;
}

// Air dates are calendar dates (midnight UTC): read in UTC, so a timezone ahead doesn't show the next day.
const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
export function formatDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : dateFmt.format(d);
}

export function seasonLabel(season: number) {
  return season === 0 ? "Specials" : `Season ${season}`;
}

/** A facts line under a title: the parts that are there, joined by " · " ("Movie · Drama · 2h 10m"). */
export function joinFacts(parts: readonly (string | number | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" · ");
}

/** What kind of title it is: "Movie" or "Series" and its first two genres. */
export function kindFacts(item: { type: string; genres?: string[] }): string[] {
  return [item.type === "movie" ? "Movie" : "Series", ...(item.genres ?? []).slice(0, 2)];
}

/** "49 min" → "49m", "142 min" → "2h 22m", "1h 2min" → "1h 2m" */
export const shortRuntime = (runtime?: string) =>
  runtime?.replace(/^(\d+)\s*min$/, (_, n) => {
    const minutes = Number(n);
    const h = Math.floor(minutes / 60);
    return h ? `${h}h ${minutes % 60}m` : `${minutes}m`;
  }).replace(/\s*min$/, "m");

const GB = 1e9;

/** "12.4 GB" / "850 MB" / "1.2 TB", as the stream ranker writes sizes; under a megabyte, "<1 MB". */
export const formatBytes = (b: number) =>
  b >= 0.99995e12 ? `${(b / 1e12).toFixed(1)} TB` : b >= GB ? `${(b / GB).toFixed(1)} GB` : b >= 0.5e6 ? `${Math.round(b / 1e6)} MB` : "<1 MB";
