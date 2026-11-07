import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import { api } from "../api";
import { keys, useContinueWatching, useLibrary, useWatchHistory } from "../net/queries";
import { concurrency } from "../net/limiter";
import type { Meta, Video } from "../types";

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
/** Lookups in flight at once: the rest queue instead of asking for 60 shows in one go. */
const lookup = concurrency(6);

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

/**
 * `all`: every dated episode, not just the last week and the next 90 days (TV mode's Calendar, which
 * can go to any week). The same shows and lookups either way.
 */
export function useCalendar(enabled = true, all = false) {
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
      queryFn: () => lookup(() => api.meta("series", id)),
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
    const from = all ? -Infinity : today - PAST_DAYS * DAY;
    const to = all ? Infinity : today + FUTURE_DAYS * DAY;
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
  }, [stamp, all]);

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

/** The locale's first day of the week, as `Date.getDay()` counts (0 = Sunday); Monday where the browser can't say. */
function firstWeekday() {
  try {
    const locale = new Intl.Locale(navigator.language) as Intl.Locale & {
      getWeekInfo?: () => { firstDay: number };
      weekInfo?: { firstDay: number };
    };
    const first = (locale.getWeekInfo?.() ?? locale.weekInfo)?.firstDay; // 1 = Monday … 7 = Sunday
    return first ? first % 7 : 1;
  } catch {
    return 1;
  }
}

/** Local midnight of the first day of the week `t` falls in, `offset` weeks on. */
export function weekStart(t: number, offset = 0, first = firstWeekday()) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() - first + 7) % 7) + offset * 7);
  return d.getTime();
}

/** The seven days of the week starting at `start`, each its local midnight (DST-safe). */
export function weekDays(start: number) {
  const d = new Date(start);
  return Array.from({ length: 7 }, (_, i) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + i).getTime());
}

/** The starts of the weeks a month's days fall in (4–6), for a month grid. `month` is 0-based. */
export function monthWeeks(year: number, month: number, first = firstWeekday()) {
  const out: number[] = [];
  const end = new Date(year, month + 1, 1).getTime();
  for (let start = weekStart(new Date(year, month, 1).getTime(), 0, first); start < end; start = weekStart(start, 1, first)) out.push(start);
  return out;
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
