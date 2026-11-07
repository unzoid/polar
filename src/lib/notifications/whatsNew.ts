import type { ContentType, Video } from "../types";

/**
 * Deciding what's new in a series (#209), from the episode list Polarity already loads. Pure: the
 * checker (check.ts) brings the shows and keeps the memory; this only compares.
 *
 * - The first time a show is seen, everything already out is remembered and nothing is said:
 *   adding a show to the library doesn't announce its back catalogue.
 * - After that, an episode is news once its air date has come and it isn't remembered yet. One
 *   that turns up dated before the show was first seen (a listing fixed, episodes renumbered) is
 *   remembered quietly.
 * - An episode without a date is never news by itself: nobody can say it's out. It becomes news
 *   when a date arrives and has passed.
 * - At most one notification per show per local day; what comes later that day waits for the next.
 * - The memory is kept on the device, so a restart repeats nothing.
 */

export interface ShowMemory {
  /** Episode ids already out (or already announced). */
  known: string[];
  /** Regular seasons (1+) with an episode out. */
  seasons: number[];
  /** When the show was first seen. */
  since: number;
  /** The local day ("2026-11-07") of the last notification about it. */
  notifiedDay?: string;
}

export interface Show {
  id: string;
  type: ContentType;
  name: string;
  videos: readonly Video[];
}

/** A new season of its own, or new episodes in the seasons already out (specials count as episodes). */
export type NewsKind = "episodes" | "season";

export interface News {
  kind: NewsKind;
  show: Show;
  /** What's out since last time, in order. */
  videos: Video[];
  /** "season": the first new one. */
  season?: number;
}

export interface Wanted {
  episodes: boolean;
  seasons: boolean;
}

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00(?::00(?:\.0+)?)?(?:Z|[+-]00:?00)?)?$/;

/**
 * When an episode counts as out. Air dates are calendar dates ("2026-11-07", or that day at
 * midnight UTC as most listings write it): out at the start of that day where the user is, so
 * nobody west of Greenwich hears of it the evening before. A full timestamp with a time of day is
 * taken as written. No date or a broken one: null.
 */
export function outAt(released?: string): number | null {
  if (!released) return null;
  const m = DAY_RE.exec(released);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  const t = new Date(released).getTime();
  return Number.isNaN(t) ? null : t;
}

/** The local calendar day of `t`, as "2026-11-07". */
export function localDay(t: number): string {
  const d = new Date(t);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const isOut = (v: Video, now: number) => {
  const t = outAt(v.released);
  return t != null && t <= now;
};

const regularSeasons = (videos: readonly Video[]) => [...new Set(videos.filter((v) => v.season > 0).map((v) => v.season))].sort((a, b) => a - b);

/** A show seen for the first time: what's out is remembered, nothing is news. */
export function firstLook(show: Show, now: number): ShowMemory {
  const out = show.videos.filter((v) => isOut(v, now));
  return { known: out.map((v) => v.id), seasons: regularSeasons(out), since: now };
}

/**
 * What's new in `show` since `memory`, and the memory after it. `wanted` says which kinds the user
 * wants: a new season with seasons off is announced as new episodes (if those are on); news of a
 * kind that's off is remembered without a word, so turning it back on doesn't bring a backlog.
 */
export function whatsNew(show: Show, memory: ShowMemory | undefined, now: number, wanted: Wanted): { news?: News; memory: ShowMemory } {
  if (!memory) return { memory: firstLook(show, now) };
  const today = localDay(now);
  const known = new Set(memory.known);
  const fresh = show.videos.filter((v) => !known.has(v.id) && isOut(v, now));
  if (fresh.length === 0) return { memory };

  // Dated before the show was first seen: a correction, not an episode that just came out.
  const stale = fresh.filter((v) => (outAt(v.released) ?? 0) < memory.since);
  const recent = fresh.filter((v) => !stale.includes(v));
  if (recent.length === 0) return { memory: remember(memory, stale) };
  if (memory.notifiedDay === today) return { memory: remember(memory, stale) };

  const seasonsBefore = new Set(memory.seasons);
  const newSeasons = regularSeasons(recent).filter((s) => !seasonsBefore.has(s));
  const kind: NewsKind | undefined = newSeasons.length && wanted.seasons ? "season" : wanted.episodes ? "episodes" : undefined;
  const after = remember(memory, fresh);
  if (!kind) return { memory: after };
  return {
    news: { kind, show, videos: recent, ...(kind === "season" ? { season: newSeasons[0] } : {}) },
    memory: { ...after, notifiedDay: today },
  };
}

function remember(memory: ShowMemory, videos: readonly Video[]): ShowMemory {
  if (videos.length === 0) return memory;
  return {
    ...memory,
    known: [...new Set([...memory.known, ...videos.map((v) => v.id)])],
    seasons: [...new Set([...memory.seasons, ...regularSeasons(videos)])].sort((a, b) => a - b),
  };
}

/** News that will come by itself, from air dates already listed, and the memory as it will be then. */
export interface Planned {
  at: number;
  news: News;
  memory: ShowMemory;
}

/** The local midnight after `t`. */
const nextMidnight = (t: number) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
};

/**
 * What `show` will bring between `now` and `until`, if its listing doesn't change: the moments a
 * check would find news, each with the memory after it. Phones hand these to the system so they
 * arrive with the app closed (check.ts); the next check takes the latest one that has passed as
 * said, and plans the rest again.
 */
export function upcoming(show: Show, memory: ShowMemory, now: number, until: number, wanted: Wanted): Planned[] {
  const times = new Set<number>();
  for (const v of show.videos) {
    const t = outAt(v.released);
    if (t != null && t > now && t <= until) {
      times.add(t);
      // Held back by the one-a-day rule: it goes out at the next midnight.
      if (nextMidnight(t) <= until) times.add(nextMidnight(t));
    }
  }
  const out: Planned[] = [];
  let m = memory;
  for (const at of [...times].sort((a, b) => a - b)) {
    const r = whatsNew(show, m, at, wanted);
    m = r.memory;
    if (r.news) out.push({ at, news: r.news, memory: m });
  }
  return out;
}
