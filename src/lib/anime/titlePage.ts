import type { AnimeLink } from "../library/identity";
import { storeLocal } from "../errors";
import { isRecord, storedJson } from "../parse";
import type { ContentType, MetaPreview } from "../types";

/**
 * Which page a title opens on (test report 1, item 1): an anime has one page, its AniList one,
 * whichever id it was reached by (`tt…` from Continue Watching, Library or a Cinemeta card,
 * `kitsu:…`), and the choice is made before any page renders, so the series page never shows
 * for an anime and is never swapped for another one. A stored anime link answers at once; then
 * an answer remembered from an earlier start; only then the network (the title's genres,
 * ani.zip, AniList).
 */
export type TitlePage = { kind: "anime"; anilist: number } | { kind: "title" };

export interface PageLookup {
  animeEnabled: boolean;
  links: () => Promise<AnimeLink[]>;
  meta: (type: ContentType, id: string) => Promise<MetaPreview | null>;
  anilistForImdb: (id: string, title: { type: string; name: string; year?: number }) => Promise<number | null>;
  anilistForKitsu: (kitsu: number) => Promise<number | null>;
  storage: Pick<Storage, "getItem" | "setItem"> | undefined;
  now: () => number;
}

const STORAGE = "polar.titlePages";
/** "Not an anime" is asked again after this long: a new show gets its ani.zip mapping late. */
const NOT_ANIME_FOR = 7 * 86_400_000;

const TITLE: TitlePage = { kind: "title" };
const anime = (anilist: number): TitlePage => ({ kind: "anime", anilist });

/** Remembered answers: id → [AniList id or 0 for "not an anime", when asked (ms)]. */
type Remembered = Record<string, [number, number]>;
function remembered(storage: PageLookup["storage"]): Remembered {
  const v = storedJson(storage, STORAGE);
  return isRecord(v) ? (v as Remembered) : {};
}

const isAnimated = (item: Pick<MetaPreview, "genres">) => !!item.genres?.some((g) => /^anim(e|ation)$/i.test(g));

/** The page for `id`. Never throws: anything that fails opens the title as it is. */
export async function titlePage(type: ContentType, id: string, preview: MetaPreview | undefined, l: PageLookup): Promise<TitlePage> {
  if (!l.animeEnabled) return TITLE;
  const anilistPrefix = id.match(/^anilist:(\d+)$/);
  if (anilistPrefix) return anime(Number(anilistPrefix[1]));
  const kitsu = Number(id.match(/^kitsu:(\d+)$/)?.[1]) || undefined;
  if (!kitsu && !id.startsWith("tt")) return TITLE;

  // The entry the user opened before (the oldest AniList entry: one IMDb id covers every season).
  const links = await l.links().catch(() => [] as AnimeLink[]);
  const linked = links
    .filter((k) => k.canonical === id || (kitsu !== undefined && k.kitsu === kitsu))
    .sort((a, b) => a.anilist - b.anilist)[0];
  if (linked) return anime(linked.anilist);

  const known = remembered(l.storage)[id];
  if (known && (known[0] > 0 || l.now() - known[1] < NOT_ANIME_FOR)) return known[0] > 0 ? anime(known[0]) : TITLE;

  try {
    let found: number | null;
    if (kitsu) found = await l.anilistForKitsu(kitsu);
    else {
      const item = preview?.genres?.length ? preview : ((await l.meta(type, id)) ?? preview);
      if (!item || !isAnimated(item)) return TITLE;
      const year = Number(item.releaseInfo?.match(/\d{4}/)?.[0]) || undefined;
      found = await l.anilistForImdb(id, { type: item.type, name: item.name, year });
    }
    storeLocal(STORAGE, JSON.stringify({ ...remembered(l.storage), [id]: [found ?? 0, l.now()] }), l.storage);
    return found ? anime(found) : TITLE;
  } catch {
    return TITLE;
  }
}
