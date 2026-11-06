/**
 * A franchise's seasons from AniList's prequel/sequel links (test report 1, items 8 and 12). Pure:
 * the network comes in as `link`, so tests walk made-up franchises.
 */
import type { AnimeCard, ChainLink, MediaFormat } from "./anilist";
import { sameSplitEntry } from "./splitParts";

export interface AnimeSeason {
  card: AnimeCard;
  label: string;
}

/** Kinds of entry that can be a "season" of a franchise. OVAs, specials and recaps never are. */
const SEASON_FORMATS = new Set<MediaFormat>(["TV", "TV_SHORT", "ONA", "MOVIE"]);
/** Long franchises (Ginbou, Kotodama) have many entries; nobody's has this many. */
const MAX_HOPS = 20;
/** An ONA or short this long or shorter is a side story (Salt Horizon's one-episode LANTERNS), not a season. */
const SIDE_STORY_EPISODES = 3;

/**
 * Whether an entry is one of the franchise's seasons: a TV run or a film, or a web series or short
 * with a real run. A one-off ONA set before the show is stepped through like an OVA, so it never
 * takes "Season 1" from the show (AniList's PREQUEL means "comes before", not "the season before").
 * An entry whose length isn't known yet (still airing) counts.
 */
export function isSeason(card: Pick<AnimeCard, "format" | "episodes">): boolean {
  if (!card.format || !SEASON_FORMATS.has(card.format)) return false;
  if (card.format === "ONA" || card.format === "TV_SHORT") return card.episodes == null || card.episodes > SIDE_STORY_EPISODES;
  return true;
}

export interface SeasonWalk {
  seasons: AnimeSeason[];
  /** False when a step failed (AniList busy): the seasons found so far, to be asked again later. */
  complete: boolean;
}

/**
 * The franchise around `root` in watch order: AniList links each entry only to its direct prequel
 * and sequel, so the chain is walked one hop at a time both ways. An entry that came with its
 * neighbours' details (`full`) saves a request per hop. A hop that fails ends that way with what
 * was found instead of failing the whole list.
 */
export async function walkSeasons(root: ChainLink, link: (id: number) => Promise<ChainLink>): Promise<SeasonWalk> {
  const seen = new Set([root.id]);
  let complete = true;
  const walk = async (from: ChainLink, way: "PREQUEL" | "SEQUEL") => {
    const out: ChainLink[] = [];
    let at = from;
    for (let hop = 0; hop < MAX_HOPS; hop++) {
      const next = at.relations.edges
        .filter((e) => e.relationType === way && e.node.type !== "MANGA" && !seen.has(e.node.id))
        // Several prequels (a film and a series): follow the series.
        .sort((a, b) => Number(!SEASON_FORMATS.has(a.node.format!)) - Number(!SEASON_FORMATS.has(b.node.format!)))[0];
      if (!next) break;
      seen.add(next.node.id);
      try {
        at = next.node.full ?? (await link(next.node.id));
      } catch {
        complete = false;
        break;
      }
      out.push(at);
    }
    return out;
  };
  const [before, after] = await Promise.all([walk(root, "PREQUEL"), walk(root, "SEQUEL")]);
  const all = [...before.reverse(), root, ...after];
  // A short first part of a split entry ("… - 1st Leg" before "… - 2nd Leg") is a season like the rest of it.
  const part = (n: ChainLink, i: number) => [all[i - 1], all[i + 1]].some((m) => !!m && m.format !== "MOVIE" && isSeason(m) && sameSplitEntry(n, m));
  const chain = all.filter((n, i) => n.id === root.id || (SEASON_FORMATS.has(n.format!) && (isSeason(n) || part(n, i))));
  let season = 0;
  return {
    seasons: chain.map((card) => ({ card, label: card.format === "MOVIE" ? "Movie" : `Season ${++season}` })),
    complete,
  };
}
