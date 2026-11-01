import type { Video } from "./types";

export function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds % 60);
  const m = Math.floor((seconds / 60) % 60);
  const h = Math.floor(seconds / 3600);
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/** "1h 12m left" — remaining time reads better than a bare percentage. */
export function formatRemaining(position: number, duration: number) {
  const left = Math.max(0, duration - position);
  const h = Math.floor(left / 3600);
  const m = Math.round((left % 3600) / 60);
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

export function isReleased(video: Video) {
  return !video.released || new Date(video.released).getTime() <= Date.now();
}

const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
export function formatDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : dateFmt.format(d);
}

export function seasonLabel(season: number) {
  return season === 0 ? "Specials" : `Season ${season}`;
}
