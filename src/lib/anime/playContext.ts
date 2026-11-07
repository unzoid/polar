import { parseVideoId, titleOfVideo } from "../library/identity";
import { count, isRecord, listOf, storedJson } from "../parse";

/**
 * What the player needs to know about an anime episode that its video id
 * doesn't say: the episode's number in its anime entry (AniList's,
 * MyAnimeList's and Kitsu's numbering, where an IMDb id says season and
 * episode), that entry's MAL and Kitsu ids, and which episodes are filler.
 * The anime page works this out when it lines the episodes up (AnimeDetail's
 * usePlayback) and leaves it here, kept in localStorage, so playing from
 * Continue Watching, TV mode or after a restart has it too.
 *
 * One IMDb show is often several anime entries (seasons, split cours), each
 * with its own Kitsu and MAL ids and its own numbering, so the ids are kept
 * per episode: opening one entry's page doesn't change what another's
 * episodes are asked by.
 *
 * Uses: AniSkip asks by MAL id and number (aniskip.ts); stream addons are
 * also asked for the Kitsu id of an IMDb-numbered episode (`kitsu:48036:5`,
 * which many anime addons index by; api.streams), and files numbered from
 * the start of the show count as the episode; the player's "skip filler"
 * autoplay.
 *
 * Kept per title (the canonical id, docs/anime-identity.md), the titles
 * looked at most recently first; at most MAX_TITLES.
 */
interface EpisodeIds {
  /** The episode's number in its entry. */
  n: number;
  mal?: number;
  kitsu?: number;
  /** Counted from the start of the show (ani.zip's absolute number), when known. */
  abs?: number;
  /** The entry's AniList id and its number of episodes, when known: linked lists are told of the episode (#83, #84). */
  al?: number;
  of?: number;
}

interface TitleContext {
  /** The entry last lined up: films, and episodes kept by an older version, which only had these. */
  mal?: number;
  kitsu?: number;
  /** Video id → its entry's ids and number; an older version kept the number alone. */
  eps: Record<string, EpisodeIds | number>;
  /** Filler episodes, by video id. */
  fillers?: string[];
  /** Filler episodes by number, as an older version kept them: only for its episodes. */
  filler?: number[];
  /** ms, when the page last left this; the oldest titles go first. */
  at: number;
}

type Saved = Record<string, TitleContext>;

/** The entry an episode belongs to, by each list service's id, for linked lists (#83, #84). */
export interface ListEpisode {
  anilist?: number;
  mal?: number;
  /** The episode's number in the entry. */
  episode: number;
  /** The entry's number of episodes, when known. */
  total: number | null;
}

export interface EpisodeContext {
  mal?: number;
  kitsu?: number;
  /** The episode's number in its entry. */
  episode: number;
}

/** One lined-up episode: its video, its number in the entry and, when known, from the start of the show. */
export type LinedEpisode = [videoId: string, n: number, absolute?: number];

const MAX_TITLES = 300;
const STORAGE = "polar.animePlayContext.v1";

/** The part of `Storage` this needs; tests pass a Map-backed one. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function readEpisode(v: unknown): EpisodeIds | number | undefined {
  if (!isRecord(v)) return count(v);
  const n = count(v.n);
  if (n === undefined) return undefined;
  const [mal, kitsu, abs, al, of] = [count(v.mal), count(v.kitsu), count(v.abs), count(v.al), count(v.of)];
  return {
    n,
    ...(mal !== undefined && { mal }),
    ...(kitsu !== undefined && { kitsu }),
    ...(abs !== undefined && { abs }),
    ...(al !== undefined && { al }),
    ...(of !== undefined && { of }),
  };
}

/** What an older version or a damaged store left: titles and fields that don't fit are left out (critique M9). */
function readSaved(v: unknown): Saved {
  if (!isRecord(v)) return {};
  const out: Saved = {};
  for (const [title, t] of Object.entries(v)) {
    if (!isRecord(t)) continue;
    const [mal, kitsu, at] = [count(t.mal), count(t.kitsu), count(t.at)];
    const eps: TitleContext["eps"] = {};
    for (const [video, v] of Object.entries(isRecord(t.eps) ? t.eps : {})) {
      const e = readEpisode(v);
      if (e !== undefined) eps[video] = e;
    }
    const filler = listOf(t.filler, count);
    const fillers = listOf(t.fillers, (x) => (typeof x === "string" ? x : undefined));
    out[title] = {
      ...(mal !== undefined && { mal }),
      ...(kitsu !== undefined && { kitsu }),
      eps,
      ...(fillers.length > 0 && { fillers }),
      ...(filler.length > 0 && { filler }),
      at: at ?? 0,
    };
  }
  return out;
}

/**
 * The episodes of one entry worth keeping: a number past the entry's last
 * episode, or one two videos claim (or a video with two numbers), would ask
 * the add-ons for another episode, so those are left out.
 */
function fitting(episodes: LinedEpisode[], count: number | undefined): LinedEpisode[] {
  const times = (key: (e: LinedEpisode) => string | number) => {
    const m = new Map<string | number, number>();
    for (const e of episodes) m.set(key(e), (m.get(key(e)) ?? 0) + 1);
    return m;
  };
  const [byVideo, byNumber] = [times((e) => e[0]), times((e) => e[1])];
  return episodes.filter(([video, n]) => byVideo.get(video) === 1 && byNumber.get(n) === 1 && n >= 1 && (count === undefined || n <= count));
}

export function playContextStore(storage: KeyValue | undefined, now: () => number = Date.now) {
  let cache: Saved | undefined;
  const load = (): Saved => {
    if (cache) return cache;
    cache = readSaved(storedJson(storage, STORAGE));
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

  /** A video's ids: what its entry's page left, else (kept by an older version) the number with the title's MAL id. */
  const idsOf = (ctx: TitleContext | undefined, videoId: string): EpisodeIds | undefined => {
    const v = parseVideoId(videoId);
    const e = ctx?.eps[videoId];
    if (typeof e === "object") return e;
    if (v?.title.kind === "kitsu" && v.episode !== undefined) return { n: v.episode, mal: ctx?.mal, kitsu: Number(v.title.value) };
    return e === undefined ? undefined : { n: e, mal: ctx?.mal };
  };

  return {
    /**
     * One entry's episodes as its anime page lined them up. Replaces what was kept for this entry's
     * episodes (and anything an older version kept for the title); other entries' stay. `count`: the
     * entry's number of episodes, when known; numbers past it are dropped. `anilist`: the entry's
     * AniList id, kept with each episode for a linked list. Filler flags stay until `filler` replaces them.
     */
    remember(titleId: string, ids: { mal?: number; kitsu?: number; anilist?: number; count?: number }, episodes: LinedEpisode[]) {
      const all = load();
      const old = all[titleId];
      const entry = (e: EpisodeIds) => (ids.kitsu !== undefined ? e.kitsu === ids.kitsu : ids.mal !== undefined && e.kitsu === undefined && e.mal === ids.mal);
      const eps: TitleContext["eps"] = {};
      for (const [video, e] of Object.entries(old?.eps ?? {})) if (typeof e === "object" && !entry(e)) eps[video] = e;
      for (const [videoId, n, abs] of fitting(episodes, ids.count)) {
        eps[videoId] = {
          n,
          ...(ids.mal !== undefined && { mal: ids.mal }),
          ...(ids.kitsu !== undefined && { kitsu: ids.kitsu }),
          ...(abs !== undefined && { abs }),
          ...(ids.anilist !== undefined && { al: ids.anilist }),
          ...(ids.count !== undefined && { of: ids.count }),
        };
      }
      const next: TitleContext = { ...(ids.mal !== undefined && { mal: ids.mal }), ...(ids.kitsu !== undefined && { kitsu: ids.kitsu }), eps, at: now() };
      if (old?.fillers) next.fillers = old.fillers;
      if (old && JSON.stringify({ ...old, at: 0 }) === JSON.stringify({ ...next, at: 0 }) && now() - old.at < 86_400_000) return;
      all[titleId] = next;
      save();
    },
    /** Which of one entry's episodes (`shown`, by video id) are filler; other entries' flags stay. */
    filler(titleId: string, shown: string[], filler: string[]) {
      const all = load();
      const ctx = (all[titleId] ??= { eps: {}, at: now() });
      const gone = new Set(shown);
      const next = [...new Set([...(ctx.fillers ?? []).filter((v) => !gone.has(v)), ...filler])].sort();
      if (JSON.stringify(ctx.fillers ?? []) === JSON.stringify(next) && !ctx.filler) return;
      delete ctx.filler;
      if (next.length) ctx.fillers = next;
      else delete ctx.fillers;
      save();
    },
    /** What the page knew about this video, or undefined when it was never lined up. */
    episode(videoId: string): EpisodeContext | undefined {
      const ids = idsOf(load()[titleOfVideo(videoId)], videoId);
      return ids && { mal: ids.mal, kitsu: ids.kitsu, episode: ids.n };
    },
    /** The entry the video is an episode of (its AniList and MAL ids), and its number there, when its page knew them. */
    listEpisode(videoId: string): ListEpisode | undefined {
      const e = load()[titleOfVideo(videoId)]?.eps[videoId];
      if (typeof e !== "object" || (e.al === undefined && e.mal === undefined)) return undefined;
      return { ...(e.al !== undefined && { anilist: e.al }), ...(e.mal !== undefined && { mal: e.mal }), episode: e.n, total: e.of ?? null };
    },
    /**
     * Other ids stream addons may know the video by: the Kitsu episode (or movie) for IMDb ids. Only
     * from what the episode's own entry left: a number an older version kept, without its entry's
     * Kitsu id, isn't asked by.
     */
    altIds(videoId: string): string[] | undefined {
      const v = parseVideoId(videoId);
      if (v?.title.kind !== "imdb") return undefined;
      const ctx = load()[v.title.value];
      if (v.episode === undefined) return ctx?.kitsu ? [`kitsu:${ctx.kitsu}`] : undefined;
      const e = ctx?.eps[videoId];
      return typeof e === "object" && e.kitsu ? [`kitsu:${e.kitsu}:${e.n}`] : undefined;
    },
    /** The video's number counted from the start of the show, when its page knew it: files may be numbered that way. */
    absolute(videoId: string): number | undefined {
      const e = load()[titleOfVideo(videoId)]?.eps[videoId];
      return typeof e === "object" ? e.abs : undefined;
    },
    isFiller(videoId: string): boolean {
      const ctx = load()[titleOfVideo(videoId)];
      if (ctx?.fillers?.includes(videoId)) return true;
      const e = ctx?.eps[videoId];
      return typeof e === "number" && !!ctx?.filler?.includes(e);
    },
  };
}

export const playContext = playContextStore(typeof localStorage === "undefined" ? undefined : localStorage);
