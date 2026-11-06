/**
 * One card per franchise in every anime list (test report 1, item 11): search, shelves, genres,
 * browse and TV rails; or, with Settings → Anime → Seasons as separate shows (#22), every entry
 * as it came. Pure; type-only imports.
 */
import type { AnimeCard } from "./anilist";

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * The franchise a title names: what comes before its subtitle or season ("Ginbou: THE LAST CURTAIN",
 * "Ginbou Season 3" and "Ginbou°" are all "ginbou"; "Re:START -Another Morning-"
 * is "restart"). Empty when nothing's left.
 */
export function franchiseName(title: string | null | undefined): string {
  if (!title) return "";
  const head = title.split(/:\s|\s[-–—~]\s?|\s(?:season|part|cour|the movie|movie|film|\d+(?:st|nd|rd|th) season)\b/i)[0];
  return norm(head);
}

/**
 * Lists answer with several entries of one franchise (Paleblade, then each part of Thousand-Year Blood
 * War; Ginbou twice in Highest Rated): keep the first of each, in the order given. Its page has the
 * rest as season tabs. Entries count as one franchise when one is the other's prequel or sequel,
 * directly or through the others, or when their titles name the same franchise in the same language.
 */
export function oneFranchiseEach<T extends AnimeCard>(items: T[]): T[] {
  const root = new Map<number, number>(items.map((a) => [a.id, a.id]));
  const find = (id: number): number => {
    const up = root.get(id)!;
    if (up === id) return id;
    const top = find(up);
    root.set(id, top);
    return top;
  };
  const join = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) root.set(rb, ra);
  };
  const byName = new Map<string, number>();
  for (const a of items) {
    for (const b of a.chain ?? []) if (root.has(b)) join(b, a.id);
    for (const [lang, t] of [
      ["en", a.title.english],
      ["ro", a.title.romaji],
    ] as const) {
      const name = franchiseName(t);
      if (name.length < 3) continue;
      const key = `${lang}:${name}`;
      const other = byName.get(key);
      if (other === undefined) byName.set(key, a.id);
      else join(other, a.id);
    }
  }
  const seen = new Set<number>();
  return items.filter((a) => {
    const r = find(a.id);
    return !seen.has(r) && !!seen.add(r);
  });
}

/** A list as the cards to show: every entry with seasons as separate shows (#22), else one per franchise. */
export function cardsShown<T extends AnimeCard>(items: T[], separate: boolean): T[] {
  return separate ? items : oneFranchiseEach(items);
}
