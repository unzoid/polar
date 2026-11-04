import { parseVideoId, titleOfVideo } from "../identity";

/**
 * What the player needs to know about an anime episode that its video id
 * doesn't say: the episode's absolute number (AniList's, MyAnimeList's and
 * Kitsu's numbering, where an IMDb id says season and episode), the show's
 * MAL and Kitsu ids, and which episodes are filler. The anime page works
 * this out when it lines the episodes up (AnimeDetail's usePlayback) and
 * leaves it here, kept in localStorage, so playing from Continue Watching,
 * TV mode or after a restart has it too.
 *
 * Uses: AniSkip asks by MAL id and absolute number (aniskip.ts); stream
 * addons are also asked for the Kitsu id of an IMDb-numbered episode
 * (`kitsu:48036:5`, which many anime addons index by; api.streams); the
 * player's "skip filler" autoplay.
 *
 * Kept per title (the canonical id, docs/anime-identity.md), the titles
 * looked at most recently first; at most MAX_TITLES.
 */
interface TitleContext {
  mal?: number;
  kitsu?: number;
  /** Video id → absolute episode number, for videos whose id doesn't carry it (IMDb `tt…:S:E`). */
  eps: Record<string, number>;
  /** Absolute numbers of filler episodes. */
  filler?: number[];
  /** ms, when the page last left this; the oldest titles go first. */
  at: number;
}

type Saved = Record<string, TitleContext>;

export interface EpisodeContext {
  mal?: number;
  kitsu?: number;
  /** Absolute episode number. */
  episode: number;
}

const MAX_TITLES = 300;
const STORAGE = "polar.animePlayContext.v1";

/** The part of `Storage` this needs; tests pass a Map-backed one. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function playContextStore(storage: KeyValue | undefined, now: () => number = Date.now) {
  let cache: Saved | undefined;
  const load = (): Saved => {
    if (cache) return cache;
    try {
      cache = (JSON.parse(storage?.getItem(STORAGE) ?? "null") as Saved | null) ?? {};
    } catch {
      cache = {};
    }
    return cache;
  };
  const save = () => {
    const all = load();
    const titles = Object.keys(all);
    if (titles.length > MAX_TITLES) {
      titles.sort((a, b) => all[b].at - all[a].at);
      for (const t of titles.slice(MAX_TITLES)) delete all[t];
    }
    try {
      storage?.setItem(STORAGE, JSON.stringify(all));
    } catch {
      // Storage full or unavailable: what's in memory still serves this run.
    }
  };

  /** The absolute number of a video: its own for `kitsu:N:E`, else what the page left. */
  const numberOf = (ctx: TitleContext | undefined, videoId: string) => {
    const v = parseVideoId(videoId);
    if (v?.title.kind === "kitsu" && v.episode !== undefined) return v.episode;
    return ctx?.eps[videoId];
  };

  return {
    /**
     * A show's episodes as its anime page lined them up: `[videoId, absolute number]`.
     * Replaces what was there for the title; filler flags stay until `filler` replaces them.
     */
    remember(titleId: string, ids: { mal?: number; kitsu?: number }, episodes: [string, number][]) {
      const all = load();
      const eps: Record<string, number> = {};
      for (const [videoId, n] of episodes) {
        const v = parseVideoId(videoId);
        if (!(v?.title.kind === "kitsu" && v.episode === n)) eps[videoId] = n;
      }
      const old = all[titleId];
      const next: TitleContext = { ...ids, eps, at: now() };
      if (old?.filler) next.filler = old.filler;
      if (old && JSON.stringify({ ...old, at: 0 }) === JSON.stringify({ ...next, at: 0 }) && now() - old.at < 86_400_000) return;
      all[titleId] = next;
      save();
    },
    /** Which of a show's episodes (absolute numbers) are filler. */
    filler(titleId: string, numbers: number[]) {
      const all = load();
      const ctx = (all[titleId] ??= { eps: {}, at: now() });
      const sorted = [...new Set(numbers)].sort((a, b) => a - b);
      if (JSON.stringify(ctx.filler ?? []) === JSON.stringify(sorted)) return;
      if (sorted.length) ctx.filler = sorted;
      else delete ctx.filler;
      save();
    },
    /** What the page knew about this video, or undefined when it was never lined up. */
    episode(videoId: string): EpisodeContext | undefined {
      const ctx = load()[titleOfVideo(videoId)];
      const episode = numberOf(ctx, videoId);
      if (!ctx || episode === undefined) return undefined;
      return { mal: ctx.mal, kitsu: ctx.kitsu, episode };
    },
    /** Other ids stream addons may know the video by: the Kitsu episode (or movie) for IMDb ids. */
    altIds(videoId: string): string[] | undefined {
      const v = parseVideoId(videoId);
      if (v?.title.kind !== "imdb") return undefined;
      const ctx = load()[v.title.value];
      if (!ctx?.kitsu) return undefined;
      if (v.episode === undefined) return [`kitsu:${ctx.kitsu}`];
      const n = ctx.eps[videoId];
      return n === undefined ? undefined : [`kitsu:${ctx.kitsu}:${n}`];
    },
    isFiller(videoId: string): boolean {
      const ctx = load()[titleOfVideo(videoId)];
      const n = numberOf(ctx, videoId);
      return n !== undefined && !!ctx?.filler?.includes(n);
    },
  };
}

export const playContext = playContextStore(typeof localStorage === "undefined" ? undefined : localStorage);
