const word = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** What's left of a label that only numbers a part ("Part 2", "Movie 3", "2nd Season"): meaningless on its own. */
const BARE = /^(the\s+)?(((part|cour|season|movie|film|chapter|vol(ume)?\.?)\s*)?([0-9]+|[ivx]+)|(\d+(st|nd|rd|th)\s+)?(season|part|cour|movie))$/i;

/** `title` minus the words it shares at the start with `base`, and how many it shared. */
function strip(title: string, base: string): { rest: string; shared: number } {
  const want = base.split(/\s+/).map(word).filter(Boolean);
  const words = title.split(/\s+/);
  let n = 0;
  let b = 0;
  // Skip words that are only punctuation ("-"), then match the franchise name word by word.
  while (n < words.length && b < want.length) {
    const w = word(words[n]);
    if (!w) n++;
    else if (w === want[b]) (n++, b++);
    else break;
  }
  const rest = words
    .slice(n)
    .join(" ")
    .replace(/^[\s:\-–—~|,.]+/, "")
    .trim();
  return { rest: b > 0 ? rest : "", shared: b };
}

/**
 * What tells each entry of a franchise apart, for its season tab: its title
 * minus the words it shares with the first one ("Tower of Glass Season 3
 * Part 2" → "Season 3 Part 2", "Ember Hunter: Hikari no Tsurugi Entertainment
 * District Arc" → "Entertainment District Arc"). The first entry, or one
 * whose title adds nothing, gets its place instead ("Season 1", "Movie").
 *
 * Each title may come in several languages (the shown one first, then the
 * same others for every entry): an entry with no English title is matched
 * romaji with romaji. One that shares nothing with the first in any language
 * (Hayato in Kazeori's franchise) keeps its own title, never a bare "Season 3"
 * (test report 1, items 9 and 19).
 */
export function distinctLabels(titles: (string | (string | null | undefined)[])[], fallbacks: string[]) {
  const variants = titles.map((t) => (Array.isArray(t) ? t : [t]));
  const base = variants[0] ?? [];
  return variants
    .map((t, i) => {
      if (i === 0) return fallbacks[0];
      for (let k = 0; k < t.length; k++) {
        const own = t[k];
        const first = base[k];
        if (!own || !first) continue;
        const { rest, shared } = strip(own, first);
        if (shared > 0) return rest || fallbacks[i];
      }
      return t[0] || fallbacks[i];
    })
    .map((label, i, all) => {
      // An arc's later parts name only what's new ("Hundred-Night Ash War - The Parting" →
      // "The Parting"), unless what they share is only a number ("Season 3" → "Season 3 Part 2")
      // or what's left is ("Endless Keep Part 2" stays whole).
      const arc = all
        .slice(1, i)
        .filter((p) => !/^(season|part|cour|movie)\b/i.test(p) && label.startsWith(`${p} `))
        .sort((a, b) => b.length - a.length)[0];
      const rest =
        arc &&
        label
          .slice(arc.length)
          .replace(/^[\s:\-–—~|,.]+/, "")
          .trim();
      return rest && !BARE.test(rest) ? rest : label;
    });
}
