/**
 * What the Anime tab's banner shows for a trending entry with seasons grouped (#325): the franchise's
 * base title's art and logo, the same as the page it opens, and the trending part named by its season
 * tab's label. Pure; the queries are in franchiseBannerQuery.ts.
 */
import type { AnimeCard, AnimeTitle } from "./anilist";
import { baseTitle } from "./baseTitle";
import { distinctLabels } from "./seasonLabels";
import type { AnimeSeason } from "./seasons";

export interface BannerBase {
  /** The franchise's base title (#246): the entry whose art the page shows. */
  base: AnimeCard;
  /** The title the page takes its art from: a `tt…` id, else null (the base's ani.zip art). */
  imdb: string | null;
  /** The trending part's season tab label; undefined when the trending entry is the base title. */
  label?: string;
}

/**
 * The base title, linked title and label for trending entry `card`, as AnimeDetail.tsx works them out:
 * `seasons` is the franchise's walk from `card` (lib/anime/seasons.ts), `linked` each entry's linked id
 * (undefined while it's being found), `title` the title in the chosen language. Undefined until it's all known.
 */
export function bannerBase(
  card: AnimeCard,
  seasons: AnimeSeason[] | undefined,
  linked: (id: number) => string | null | undefined,
  title: (t: AnimeTitle) => string,
): BannerBase | undefined {
  const found = seasons && seasons.length > 1 && seasons.some((s) => s.card.id === card.id) ? seasons : undefined;
  if (!found) {
    const own = linked(card.id);
    return own === undefined ? undefined : { base: card, imdb: own };
  }
  const base = baseTitle(
    found.map((s) => s.card),
    linked,
  );
  if (!base) return undefined;
  if (base.card.id === card.id) {
    const imdb = base.imdb ?? linked(card.id);
    return imdb === undefined ? undefined : { base: card, imdb };
  }
  // Another entry when the base has no known link: the title this one plays from, unless a movie is involved (its own title).
  const anyMovie = base.card.format === "MOVIE" || card.format === "MOVIE";
  const imdb = base.imdb ?? linked(base.card.id) ?? (anyMovie ? null : linked(card.id));
  if (imdb === undefined) return undefined;
  const labels = distinctLabels(
    found.map((s) => [title(s.card.title), s.card.title.romaji, s.card.title.english]),
    found.map((s) => s.label),
  );
  return { base: base.card, imdb, label: labels[found.findIndex((s) => s.card.id === card.id)] };
}
