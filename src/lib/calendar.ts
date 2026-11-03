import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "./api";
import { keys, useContinueWatching, useLibrary, useWatchHistory } from "./queries";
import type { Meta, Video } from "./types";

/**
 * The Calendar (Settings → Browsing, opt-in), like Stremio's: episodes of
 * your shows by the day they air. "Your shows" are the series in your
 * library plus the ones you're watching or have watched; their episode lists
 * come from the same metadata the title pages use (and share its cache).
 */

/** How far back "just aired" reaches, and how far ahead to look. */
const PAST_DAYS = 7;
const FUTURE_DAYS = 90;
/** Shows looked up at most (newest activity first). */
const MAX_SHOWS = 60;

export interface CalendarEntry {
  show: Meta;
  video: Video;
  /** Local midnight of the air date. */
  day: number;
}

const DAY = 86_400_000;
const midnight = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};

/** "2024-05-03" (or a full timestamp) → that calendar day, local time. */
function airDay(released?: string) {
  if (!released) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(released);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

export function useCalendar(enabled = true) {
  const { data: library } = useLibrary();
  const { data: watching } = useContinueWatching();
  const { data: history } = useWatchHistory();

  const ids = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (id: string, type: string) => {
      if (type !== "series" || seen.has(id)) return;
      seen.add(id);
      out.push(id);
    };
    for (const p of watching ?? []) add(p.metaId, p.type);
    for (const l of library ?? []) add(l.id, l.type);
    for (const p of history ?? []) add(p.metaId, p.type);
    return out.slice(0, MAX_SHOWS);
  }, [library, watching, history]);

  const metas = useQueries({
    queries: ids.map((id) => ({
      queryKey: keys.meta("series", id),
      queryFn: () => api.meta("series", id),
      staleTime: 60 * 60_000,
      enabled,
    })),
  });

  const loading = !library || metas.some((q) => q.isLoading);
  const shows = metas.map((q) => q.data).filter((m): m is Meta => !!m);
  // Recompute only when the set of loaded shows changes.
  const stamp = shows.map((s) => s.id).join(",");

  const entries = useMemo(() => {
    const today = midnight(Date.now());
    const from = today - PAST_DAYS * DAY;
    const to = today + FUTURE_DAYS * DAY;
    const out: CalendarEntry[] = [];
    for (const show of shows) {
      for (const video of show.videos) {
        if (video.season === 0) continue;
        const day = airDay(video.released);
        if (day == null || day < from || day > to) continue;
        out.push({ show, video, day });
      }
    }
    return out.sort((a, b) => a.day - b.day || a.show.name.localeCompare(b.show.name) || a.video.episode - b.video.episode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stamp]);

  return { entries, loading, showCount: ids.length };
}

/** Entries grouped by day, in order. */
export function byDay(entries: CalendarEntry[]) {
  const days: { day: number; entries: CalendarEntry[] }[] = [];
  for (const e of entries) {
    const last = days[days.length - 1];
    if (last?.day === e.day) last.entries.push(e);
    else days.push({ day: e.day, entries: [e] });
  }
  return days;
}

const weekday = new Intl.DateTimeFormat(undefined, { weekday: "long" });
const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "long" });

/** "Today", "Tomorrow", "Yesterday", or "Friday" (this week), with the date beside it. */
export function dayLabel(day: number) {
  const today = midnight(Date.now());
  const diff = Math.round((day - today) / DAY);
  const name = diff === 0 ? "Today" : diff === 1 ? "Tomorrow" : diff === -1 ? "Yesterday" : weekday.format(day);
  return { name, date: dateFmt.format(day), past: diff < 0, today: diff === 0 };
}
