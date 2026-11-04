/**
 * Title identity: which id a show is known by, and how other ids for the
 * same show lead to it. See docs/anime-identity.md.
 *
 * Canonical ids are what every store keys titles by: an IMDb id (`tt…`) or,
 * for anime with no IMDb page Polar plays from, `kitsu:N`. Anything else
 * (`anilist:N`, `mal:N`, and `kitsu:N` once an IMDb page is known) is an
 * alias of a canonical id. An IMDb id is never an alias, so two IMDb shows
 * are never joined into one.
 */

export type IdKind = "imdb" | "kitsu" | "anilist" | "mal";

export interface TitleId {
  kind: IdKind;
  /** `tt0000103` for IMDb; the number as text for the others. */
  value: string;
}

/** One playable video: a movie (no season/episode), an IMDb episode `tt…:S:E`, or a Kitsu episode `kitsu:N:E`. */
export interface VideoRef {
  title: TitleId;
  season?: number;
  episode?: number;
}

const IMDB = /^tt\d+$/;
const NUM = /^\d+$/;

/** A title id, or null when the string isn't one Polar knows. */
export function parseTitleId(id: string): TitleId | null {
  if (IMDB.test(id)) return { kind: "imdb", value: id };
  const [prefix, value, ...rest] = id.split(":");
  if (rest.length || !value || !NUM.test(value)) return null;
  if (prefix === "kitsu" || prefix === "anilist" || prefix === "mal") return { kind: prefix, value };
  return null;
}

export const formatTitleId = (t: TitleId) => (t.kind === "imdb" ? t.value : `${t.kind}:${t.value}`);

/** A video id: `tt1`, `tt1:2:3`, `kitsu:5`, `kitsu:5:12`. */
export function parseVideoId(id: string): VideoRef | null {
  const parts = id.split(":");
  if (IMDB.test(parts[0])) {
    if (parts.length === 1) return { title: { kind: "imdb", value: parts[0] } };
    if (parts.length === 3 && NUM.test(parts[1]) && NUM.test(parts[2]))
      return { title: { kind: "imdb", value: parts[0] }, season: Number(parts[1]), episode: Number(parts[2]) };
    return null;
  }
  if (parts[0] === "kitsu" && NUM.test(parts[1] ?? "")) {
    const title: TitleId = { kind: "kitsu", value: parts[1] };
    if (parts.length === 2) return { title };
    if (parts.length === 3 && NUM.test(parts[2])) return { title, episode: Number(parts[2]) };
  }
  return null;
}

export function formatVideoId(v: VideoRef): string {
  const t = formatTitleId(v.title);
  if (v.episode === undefined) return t;
  return v.title.kind === "imdb" ? `${t}:${v.season ?? 1}:${v.episode}` : `${t}:${v.episode}`;
}

/** The title a video id belongs to (`tt1:2:3` → `tt1`); the id itself when it isn't one Polar can read. */
export const titleOfVideo = (videoId: string) => {
  const v = parseVideoId(videoId);
  return v ? formatTitleId(v.title) : videoId;
};

/** Whether an id can be what stores key a title by. */
export const isCanonicalKind = (kind: IdKind) => kind === "imdb" || kind === "kitsu";

/**
 * What Polar knows links one anime together: its AniList entry, and the ids
 * of the same show elsewhere. `canonical` is the id Polar plays it from.
 */
export interface AnimeLink {
  canonical: string;
  anilist: number;
  mal?: number;
  kitsu?: number;
  /** ms; the latest decision about an AniList entry wins. */
  updatedAt: number;
}

/** The alias → target pairs a link stands for. Never makes an IMDb id an alias. */
export function aliasesOf(link: AnimeLink): [string, string][] {
  const out: [string, string][] = [[`anilist:${link.anilist}`, link.canonical]];
  if (link.mal !== undefined) out.push([`mal:${link.mal}`, link.canonical]);
  const kitsu = link.kitsu !== undefined ? `kitsu:${link.kitsu}` : undefined;
  if (kitsu && kitsu !== link.canonical) out.push([kitsu, link.canonical]);
  return out;
}

/**
 * Aliases from a set of links. When two links claim the same alias, the
 * newer one wins (an AniList entry re-linked to the right show replaces the
 * old answer).
 */
export function aliasTable(links: Iterable<AnimeLink>): Map<string, string> {
  const sorted = [...links].sort((a, b) => a.updatedAt - b.updatedAt);
  const table = new Map<string, string>();
  for (const l of sorted) for (const [from, to] of aliasesOf(l)) if (!IMDB.test(from)) table.set(from, to);
  return table;
}

/** Following aliases more than this many steps means a loop; the id is then left as it is. */
const MAX_STEPS = 4;

/** The canonical id for any title id: itself if nothing points elsewhere. */
export function canonicalId(id: string, aliases: ReadonlyMap<string, string>): string {
  let cur = id;
  for (let i = 0; i < MAX_STEPS; i++) {
    if (IMDB.test(cur)) return cur;
    const next = aliases.get(cur);
    if (next === undefined || next === cur) return cur;
    cur = next;
  }
  return id;
}

/** Whether two title ids name the same show. */
export const sameTitle = (a: string, b: string, aliases: ReadonlyMap<string, string>) =>
  canonicalId(a, aliases) === canonicalId(b, aliases);

/**
 * Items whose ids name the same show, kept once: the first of each, in
 * order. `idOf` reads an item's title id.
 */
export function dedupeByTitle<T>(items: T[], idOf: (t: T) => string, aliases: ReadonlyMap<string, string>): T[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    const key = canonicalId(idOf(it), aliases);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
