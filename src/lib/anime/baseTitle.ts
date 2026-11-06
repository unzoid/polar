/**
 * The entry a grouped anime page takes its backdrop, logo and header facts from (#246): the series,
 * not whichever entry the prequel and sequel chain happens to start with. Pure; type-only imports.
 */
import type { AnimeCard, MediaFormat } from "./anilist";

/** The franchise's base title, and the IMDb series it plays from when one was chosen by rule 1. */
export interface BaseTitle {
  card: AnimeCard;
  /** The `tt…` series most TV entries map to; undefined when the base wasn't chosen that way. */
  imdb?: string;
}

const TV: MediaFormat[] = ["TV"];
const TV_LIKE: MediaFormat[] = ["TV_SHORT", "ONA"];

/** When an entry started, for "earliest aired"; entries with no date go last. */
const aired = (c: AnimeCard) => {
  const d = c.startDate;
  if (!d?.year) return Infinity;
  return d.year * 10_000 + (d.month ?? 12) * 100 + (d.day ?? 31);
};

const earliest = (cards: AnimeCard[]) => cards.reduce((a, b) => (aired(b) < aired(a) ? b : a));

/**
 * The base title of a franchise's entries (in chain order), in this order of rules:
 *
 * 1. the IMDb series (`tt…`) the most TV entries are linked to, ties going to the series whose
 *    earliest TV entry aired first; its base card is that series' earliest TV entry;
 * 2. else the earliest-aired TV entry (TV_SHORT or ONA when there's no TV entry);
 * 3. else (films, OVAs, specials, recaps only) the chain's first entry.
 *
 * `linked` gives each entry's linked IMDb id: undefined while it's being found, null for none.
 * Undefined until every TV entry's link is known, so the art doesn't change once drawn.
 */
export function baseTitle(entries: AnimeCard[], linked: (id: number) => string | null | undefined): BaseTitle | undefined {
  if (entries.length === 0) return undefined;
  const tv = entries.filter((e) => e.format && TV.includes(e.format));
  const series = tv.length ? tv : entries.filter((e) => e.format && TV_LIKE.includes(e.format));
  if (series.length === 0) return { card: entries[0] };

  if (tv.length) {
    const ids = tv.map((e) => linked(e.id));
    if (ids.some((id) => id === undefined)) return undefined;
    const bySeries = new Map<string, AnimeCard[]>();
    tv.forEach((e, i) => {
      const id = ids[i];
      if (id?.startsWith("tt")) bySeries.set(id, [...(bySeries.get(id) ?? []), e]);
    });
    let best: { imdb: string; cards: AnimeCard[] } | undefined;
    for (const [imdb, cards] of bySeries) {
      if (!best || cards.length > best.cards.length || (cards.length === best.cards.length && aired(earliest(cards)) < aired(earliest(best.cards)))) {
        best = { imdb, cards };
      }
    }
    if (best) return { card: earliest(best.cards), imdb: best.imdb };
  }
  return { card: earliest(series) };
}
