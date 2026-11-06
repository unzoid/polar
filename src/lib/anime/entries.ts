import { parseVideoId, titleOfVideo } from "../library/identity";
import { count, isRecord, listOf, storedJson, str } from "../parse";
import type { Video } from "../types";
import type { AnimeTitle } from "./anilist";
import type { KeyValue } from "./playContext";

/**
 * Which AniList entry each episode of a stored title belongs to, for
 * Settings → Anime → Seasons as separate shows (#22). The library, progress
 * and history keep one item per title (`tt…` covers every season), so with
 * the setting on a card asks here which entry the episode being watched is
 * part of, and shows that entry's name and poster and opens its page.
 *
 * Display only: kept in localStorage on this device, never synced. Written
 * where an entry's episodes are lined up with the title's videos (the anime
 * page, a TV card being opened), so an entry nobody opened here isn't known
 * and its title's card shows as stored.
 *
 * An entry's episodes are kept as runs: `[season, first, last, number]` is
 * episodes `first`…`last` of `season` (0 for ids without seasons,
 * `kitsu:N:E`), the first of them being the entry's episode `number`.
 */
export type EpisodeRun = [season: number, first: number, last: number, number: number];

export interface EntryRecord {
  title: AnimeTitle;
  cover?: string;
  runs: EpisodeRun[];
  /** ms, when it was last lined up: when two entries claim an episode, the later wins. */
  at: number;
}

/** Title id → AniList id → its record. */
type Saved = Record<string, Record<string, EntryRecord>>;

export interface EntryAt {
  anilist: number;
  title: AnimeTitle;
  cover?: string;
  /** The episode's number within the entry. */
  number: number;
}

const STORAGE = "polar.animeEntries.v1";
const MAX_TITLES = 300;

/** `[videoId, number in the entry]` as runs of consecutive episodes; videos of other titles or without an episode are left out. */
export function runsOf(titleId: string, episodes: [string, number][]): EpisodeRun[] {
  const eps = episodes
    .filter(([id]) => titleOfVideo(id) === titleId)
    .flatMap(([id, number]) => {
      const v = parseVideoId(id);
      return v?.episode === undefined ? [] : [{ season: v.season ?? 0, episode: v.episode, number }];
    })
    .sort((a, b) => a.season - b.season || a.episode - b.episode);
  const runs: EpisodeRun[] = [];
  for (const e of eps) {
    const run = runs[runs.length - 1];
    const [season, first, last, number] = run ?? [];
    if (run && season === e.season && last === e.episode) continue;
    if (run && season === e.season && last! + 1 === e.episode && number! + (e.episode - first!) === e.number) run[2] = e.episode;
    else runs.push([e.season, e.episode, e.episode, e.number]);
  }
  return runs;
}

/** What an older version or a damaged store left: records that don't fit are left out (critique M9). */
function readSaved(v: unknown): Saved {
  const out: Saved = {};
  if (!isRecord(v)) return out;
  for (const [titleId, entries] of Object.entries(v)) {
    if (!isRecord(entries)) continue;
    for (const [anilist, e] of Object.entries(entries)) {
      if (!isRecord(e) || !isRecord(e.title) || count(anilist) === undefined) continue;
      const runs = listOf(e.runs, (r) => (Array.isArray(r) && r.length === 4 && r.every((n) => count(n) !== undefined) ? (r as EpisodeRun) : undefined));
      const title: AnimeTitle = { romaji: str(e.title.romaji), english: str(e.title.english), native: str(e.title.native) };
      (out[titleId] ??= {})[anilist] = { title, cover: str(e.cover), runs, at: count(e.at) ?? 0 };
    }
  }
  return out;
}

const latest = (entries: Record<string, EntryRecord>) => Math.max(0, ...Object.values(entries).map((e) => e.at));

export function entryStore(storage: KeyValue | undefined, now: () => number = Date.now) {
  let cache: Saved | undefined;
  const load = (): Saved => (cache ??= readSaved(storedJson(storage, STORAGE)));
  const save = () => {
    const all = load();
    const titles = Object.keys(all);
    if (titles.length > MAX_TITLES) {
      titles.sort((a, b) => latest(all[b]) - latest(all[a]));
      for (const t of titles.slice(MAX_TITLES)) delete all[t];
    }
    try {
      storage?.setItem(STORAGE, JSON.stringify(all));
    } catch {
      // Storage full or unavailable: what's in memory still serves this run.
    }
  };

  return {
    /** An entry's episodes as they were lined up with its title's videos: `[videoId, number in the entry]`. Replaces what it had. */
    remember(titleId: string, anilist: number, show: { title: AnimeTitle; cover?: string | null }, episodes: [string, number][]) {
      const runs = runsOf(titleId, episodes);
      if (!runs.length) return;
      const all = load();
      const entries = (all[titleId] ??= {});
      const old = entries[anilist];
      const next: EntryRecord = { title: show.title, cover: show.cover ?? undefined, runs, at: now() };
      if (old && JSON.stringify({ ...old, at: 0 }) === JSON.stringify({ ...next, at: 0 }) && now() - old.at < 86_400_000) return;
      entries[anilist] = next;
      save();
    },
    /** The entry a video is part of, or undefined when no entry lined up here has it. */
    entryAt(videoId: string): EntryAt | undefined {
      const v = parseVideoId(videoId);
      if (v?.episode === undefined) return undefined;
      const entries = load()[titleOfVideo(videoId)];
      if (!entries) return undefined;
      const season = v.season ?? 0;
      let found: (EntryAt & { at: number }) | undefined;
      for (const [anilist, e] of Object.entries(entries)) {
        const run = e.runs.find(([s, first, last]) => s === season && first <= v.episode! && v.episode! <= last);
        if (run && (!found || e.at > found.at))
          found = { anilist: Number(anilist), title: e.title, cover: e.cover, number: run[3] + v.episode - run[1], at: e.at };
      }
      if (!found) return undefined;
      const { at: _at, ...entry } = found;
      return entry;
    },
    /** One entry of a title, for a page that shows only that entry's episodes; undefined when it was never lined up here. */
    entry(titleId: string, anilist: number): EntryRecord | undefined {
      return load()[titleId]?.[anilist];
    },
  };
}

/**
 * A title's page as one entry's (TV mode with seasons as separate shows): the entry's name and poster,
 * and only its episodes, as one season numbered as in the entry. Each keeps its video id, so playing
 * and progress stay the stored title's.
 */
export function entryMeta<M extends { name: string; poster?: string; logo?: string; videos: Video[] }>(meta: M, entry: EntryRecord, name: string): M {
  const videos = meta.videos.flatMap((v) => {
    const ref = parseVideoId(v.id);
    if (ref?.episode === undefined) return [];
    const [season, episode] = [ref.season ?? 0, ref.episode];
    const run = entry.runs.find(([s, first, last]) => s === season && first <= episode && episode <= last);
    return run ? [{ ...v, season: 1, episode: run[3] + episode - run[1] }] : [];
  });
  return { ...meta, name, poster: entry.cover ?? meta.poster, logo: undefined, videos };
}

export const animeEntries = entryStore(typeof localStorage === "undefined" ? undefined : localStorage);
