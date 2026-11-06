import type { ContentType, LibraryItem, Meta, Progress, Video } from "../types";
import { runtimeSeconds } from "../format";

/**
 * Reading the file Stremio exports (its account's data as JSON) into Polarity's library and
 * progress (#12). Only the file: nothing here talks to Stremio. Add-on links can carry the user's
 * own keys or settings, so they are never logged; they are listed for the user to pick from.
 */

/** One title from the export, in Polarity's units (ms times, seconds of video). */
export interface StremioItem {
  id: string;
  type: ContentType;
  name: string;
  poster?: string;
  /** In the library (not removed), added at `addedAt`. */
  inLibrary: boolean;
  addedAt: number;
  /** When it was last played (or changed): what orders Continue Watching. */
  lastWatched: number;
  /** In Stremio's Continue Watching: `videoId` played up to `position` of `duration`. */
  resume?: { videoId: string; position: number; duration: number };
  /** A movie watched at least once, or marked watched. */
  watchedMovie: boolean;
  /** A show's watched episodes as Stremio keeps them: `<anchor video id>:<anchor length>:<bits>`. */
  watched?: string;
}

/** An add-on from the export. `url` can hold personal keys: show `name`, never log `url`. */
export interface StremioAddon {
  id: string;
  name: string;
  description?: string;
  url: string;
}

export interface StremioExport {
  items: StremioItem[];
  addons: StremioAddon[];
  /** Titles Polarity can't show, by why: what the preview and the summary explain. */
  skipped: Skipped;
}

export interface Skipped {
  /** Ids from other add-ons' own catalogs: not IMDb or Kitsu. */
  ids: number;
  /** Other kinds of item: channels, TV, other. */
  types: number;
  /** Entries without an id. */
  unreadable: number;
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
/** Stremio writes ISO dates; some copies of the data hold milliseconds. */
const time = (v: unknown) => {
  const t = typeof v === "string" ? Date.parse(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(t) && t > 0 ? t : 0;
};

/** Ids Polarity plays, IMDb titles and Kitsu anime, in the form Polarity keeps them. */
function supportedId(id: string): string | undefined {
  const imdb = /^tt(\d+)$/i.exec(id);
  if (imdb) return `tt${imdb[1]}`;
  const kitsu = /^kitsu:(\d+)$/i.exec(id);
  return kitsu ? `kitsu:${kitsu[1]}` : undefined;
}

/** An entry's type; when it's missing, what the item played says: the title itself (a movie) or one of its episodes. */
function itemType(item: Json, id: string, state: Json): string | undefined {
  const type = str(item.type)?.toLowerCase();
  if (type) return type;
  const video = str(state.video_id);
  if (video === id) return "movie";
  if (video?.startsWith(`${id}:`)) return "series";
  return undefined;
}

type Read = StremioItem | keyof Skipped;

function readItem(raw: Json): Read {
  // The export wraps each library item as { _id, _mtime, d: <item>, user_id }; some copies keep the title's id
  // only on the wrapper (`__id`).
  const item = isObject(raw.d) ? raw.d : raw;
  const given = str(item._id) ?? str(raw.__id);
  if (!given) return "unreadable";
  const state = isObject(item.state) ? item.state : {};
  const type = itemType(item, given, state);
  if (type !== "movie" && type !== "series") return "types";
  const id = supportedId(given);
  if (!id) return "ids";
  const changed = time(item._mtime) || time(raw._mtime) || time(raw._mtimestamp);
  const lastWatched = time(state.lastWatched) || changed;
  const removed = item.removed === true;
  const offset = num(state.timeOffset);
  const videoId = str(state.video_id) ?? (type === "movie" ? given : undefined);
  // Stremio's own rule for Continue Watching: not removed (or only there because it was played), started.
  const resume =
    (!removed || item.temp === true) && offset > 0 && videoId
      ? { videoId: videoId.replace(given, id), position: offset / 1000, duration: num(state.duration) / 1000 }
      : undefined;
  return {
    id,
    type,
    name: str(item.name) ?? id,
    poster: str(item.poster),
    inLibrary: !removed,
    addedAt: time(item._ctime) || changed,
    lastWatched,
    resume,
    watchedMovie: type === "movie" && (num(state.timesWatched) > 0 || num(state.flaggedWatched) > 0),
    watched: type === "series" ? str(state.watched)?.replace(given, id) : undefined,
  };
}

/** An object that is a library entry: wrapped (`d`), or an item with its id and what it is or how far it was played. */
const isEntry = (v: Json) => isObject(v.d) || (typeof v._id === "string" && ("type" in v || isObject(v.state) || "removed" in v));

/** Where the library can sit besides `library`: Stremio keeps recently played titles in a bucket of their own. */
const LIBRARY_KEYS = ["library", "library_recent", "libraryRecent", "items"];

/**
 * Every library entry in the file, wherever it sits: a list, a list under `library`, or Stremio's own buckets
 * (`{ uid, items: { <id>: <item> } }`, recent titles apart). Undefined when the file has no library at all.
 */
function libraryEntries(data: unknown): Json[] | undefined {
  if (Array.isArray(data)) return data.filter(isObject);
  if (!isObject(data)) return undefined;
  const found: Json[] = [];
  let any = false;
  const walk = (v: unknown, depth: number) => {
    if (depth > 3) return;
    const values = Array.isArray(v) ? v : isObject(v) ? Object.values(v) : [];
    for (const x of values) {
      if (!isObject(x)) continue;
      if (isEntry(x)) found.push(x);
      else walk(x, depth + 1);
    }
  };
  for (const key of LIBRARY_KEYS) {
    const v = data[key];
    if (!Array.isArray(v) && !isObject(v)) continue;
    any = true;
    walk(v, 0);
  }
  return any ? found : undefined;
}

function readAddon(raw: unknown, installed: Set<string>): StremioAddon | null {
  if (!isObject(raw) || !isObject(raw.manifest)) return null;
  const url = str(raw.transportUrl);
  const id = str(raw.manifest.id);
  if (!url || !id || !/^https?:\/\//i.test(url)) return null;
  // Stremio's built-in add-ons (its catalog, local files) are marked protected: Polarity has its own.
  if (isObject(raw.flags) && raw.flags.protected === true) return null;
  if (installed.has(id) || installed.has(url)) return null;
  return { id, name: str(raw.manifest.name) ?? id, description: str(raw.manifest.description), url };
}

/**
 * Reads an export. `installed` holds the manifest ids and URLs of add-ons already installed, which
 * aren't offered again. Throws when the file isn't a Stremio export.
 */
export function parseStremioExport(text: string, installed: Iterable<string> = []): StremioExport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file isn't JSON.");
  }
  const library = libraryEntries(data);
  const rawAddons = isObject(data) ? (isObject(data.addons) ? data.addons.addons : data.addons) : undefined;
  if (!library && !Array.isArray(rawAddons)) throw new Error("This file isn't a Stremio export: it has no library or add-ons.");

  const byId = new Map<string, StremioItem>();
  const skipped: Skipped = { ids: 0, types: 0, unreadable: 0 };
  for (const raw of library ?? []) {
    const item = readItem(raw);
    if (typeof item === "string") skipped[item]++;
    // The same title twice: the one changed last.
    else if ((byId.get(item.id)?.lastWatched ?? -1) <= item.lastWatched) byId.set(item.id, item);
  }
  const have = new Set(installed);
  const addons: StremioAddon[] = [];
  for (const raw of Array.isArray(rawAddons) ? rawAddons : []) {
    const addon = readAddon(raw, have);
    if (addon && !addons.some((a) => a.id === addon.id)) addons.push(addon);
  }
  return { items: [...byId.values()], addons, skipped };
}

/** Stremio's watched field: the anchor video, the length up to it, and the zlib-compressed bits. */
function splitWatched(field: string) {
  const parts = field.split(":");
  if (parts.length < 3) return null;
  const bits = parts.pop()!;
  const length = Number(parts.pop());
  if (!Number.isInteger(length) || length < 0) return null;
  return { anchor: parts.join(":"), length, bits };
}

async function inflate(base64: string): Promise<Uint8Array> {
  const compressed = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Bit `i`, lowest bit of each byte first, as Stremio writes them. */
const bit = (bytes: Uint8Array, i: number) => i >= 0 && i >> 3 < bytes.length && ((bytes[i >> 3] >> (i & 7)) & 1) === 1;

/** How many episodes a watched field marks, before they're matched to a show's episodes (the preview). */
export async function watchedCount(field: string): Promise<number> {
  const parsed = splitWatched(field);
  if (!parsed) return 0;
  try {
    const bytes = await inflate(parsed.bits);
    let n = 0;
    for (let i = 0; i < bytes.length * 8; i++) if (bit(bytes, i)) n++;
    return n;
  } catch {
    return 0;
  }
}

/** A show's videos in the order Stremio numbers the bits: season, episode, air date; each id once. */
export function bitOrder(videos: Video[]): string[] {
  const seen = new Set<string>();
  const released = (v: Video) => (v.released ? Date.parse(v.released) || -Infinity : -Infinity);
  return [...videos]
    .sort((a, b) => a.season - b.season || a.episode - b.episode || released(a) - released(b))
    .map((v) => v.id)
    .filter((id) => !seen.has(id) && (seen.add(id), true));
}

/**
 * The ids of the episodes a watched field marks, matched to `videos` the way Stremio does: the
 * anchor video (the last one watched) lines the bits up with the list as it is now. When the anchor
 * isn't in the list, nothing can be matched.
 */
export async function watchedVideoIds(field: string, videos: Video[]): Promise<string[]> {
  const parsed = splitWatched(field);
  if (!parsed) return [];
  const ids = bitOrder(videos);
  const anchor = ids.indexOf(parsed.anchor);
  if (anchor < 0) return [];
  let bytes: Uint8Array;
  try {
    bytes = await inflate(parsed.bits);
  } catch {
    return [];
  }
  const offset = parsed.length - anchor - 1;
  return ids.filter((_, i) => bit(bytes, i + offset));
}

export interface ImportChoice {
  library: boolean;
  /** Where each title was left (Continue Watching). */
  resume: boolean;
  /** Watched movies and episodes. */
  watched: boolean;
}

export interface ImportPlan {
  library: LibraryItem[];
  progress: Progress[];
  /** Shows whose watched episodes couldn't be matched (no metadata, or the anchor episode is gone). */
  unmatched: number;
}

/** The titles whose metadata the import needs: shows with watched episodes or a place to resume. */
export function needsMeta(items: StremioItem[], choice: ImportChoice): StremioItem[] {
  return items.filter((i) => i.type === "series" && ((choice.watched && i.watched) || (choice.resume && i.resume)));
}

const EPISODE = /:(\d+):(\d+)$/;

/**
 * What to import, with Stremio's times: library items added when they were added there; watched
 * episodes finished in order just before the title's last play, and the place to resume at it, so
 * Continue Watching keeps its order. `metas` has the shows `needsMeta` asked for (null: not found).
 */
export async function planImport(exp: StremioExport, metas: Map<string, Meta | null>, choice: ImportChoice): Promise<ImportPlan> {
  const library: LibraryItem[] = [];
  const progress: Progress[] = [];
  let unmatched = 0;
  for (const item of exp.items) {
    if (choice.library && item.inLibrary) library.push({ id: item.id, type: item.type, name: item.name, poster: item.poster, addedAt: item.addedAt });
    const meta = metas.get(item.id) ?? undefined;
    const base = { metaId: item.id, type: item.type, name: meta?.name || item.name, poster: meta?.poster ?? item.poster, background: meta?.background };
    const rows = new Map<string, Progress>();

    if (choice.watched && item.watchedMovie) {
      rows.set(item.id, { ...base, videoId: item.id, position: 1, duration: 1, updatedAt: item.lastWatched });
    }
    if (choice.watched && item.watched) {
      const ids = meta ? await watchedVideoIds(item.watched, meta.videos) : [];
      if (!ids.length) unmatched++;
      const videos = new Map(meta?.videos.map((v) => [v.id, v]));
      const length = runtimeSeconds(meta?.runtime) || 1;
      ids.forEach((id, i) => {
        const v = videos.get(id)!;
        rows.set(id, {
          ...base,
          videoId: id,
          season: v.season,
          episode: v.episode,
          episodeTitle: v.title,
          position: length,
          duration: length,
          updatedAt: item.lastWatched - (ids.length - i),
        });
      });
    }
    if (choice.resume && item.resume && item.resume.duration > 0) {
      const { videoId, position, duration } = item.resume;
      const v = meta?.videos.find((x) => x.id === videoId);
      const numbers = videoId.match(EPISODE);
      const episode =
        item.type === "series"
          ? { season: v?.season ?? Number(numbers?.[1]), episode: v?.episode ?? Number(numbers?.[2]), episodeTitle: v?.title }
          : {};
      if (item.type === "movie" || Number.isFinite(episode.season)) {
        rows.set(videoId, { ...base, ...episode, videoId, position, duration, updatedAt: item.lastWatched });
      }
    }
    progress.push(...rows.values());
  }
  return { library, progress, unmatched };
}
