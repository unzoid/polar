const word = (w: string) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * What tells each entry of a franchise apart, for its season tab: its title
 * minus the words it shares with the first one ("Tower of Glass Season 3
 * Part 2" → "Season 3 Part 2", "Ember Hunter: Hikari no Tsurugi Entertainment
 * District Arc" → "Entertainment District Arc"). The first entry, or one
 * whose title adds nothing, gets its place instead ("Season 1", "Movie").
 */
export function distinctLabels(titles: string[], fallbacks: string[]) {
  const base = (titles[0] ?? "").split(/\s+/).map(word).filter(Boolean);
  return titles
    .map((t, i) => {
      if (i === 0) return fallbacks[0];
      const words = t.split(/\s+/);
      let n = 0;
      let b = 0;
      // Skip words that are only punctuation ("-"), then match the franchise name word by word.
      while (n < words.length && b < base.length) {
        const w = word(words[n]);
        if (!w) n++;
        else if (w === base[b]) (n++, b++);
        else break;
      }
      const rest =
        b > 0
          ? words
              .slice(n)
              .join(" ")
              .replace(/^[\s:\-–—~|,.]+/, "")
              .trim()
          : "";
      return rest || fallbacks[i];
    })
    .map((label, i, all) => {
      // An arc's later parts name only what's new ("Hundred-Night Ash War - The Parting" →
      // "The Parting"), unless what they share is only a number ("Season 3" → "Season 3 Part 2").
      const arc = all
        .slice(1, i)
        .filter((p) => !/^(season|part|cour|movie)\b/i.test(p) && label.startsWith(`${p} `))
        .sort((a, b) => b.length - a.length)[0];
      return (
        (arc &&
          label
            .slice(arc.length)
            .replace(/^[\s:\-–—~|,.]+/, "")
            .trim()) ||
        label
      );
    });
}
