import { describe, expect, test } from "bun:test";

// The anime modules reach ones that read localStorage when they load.
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const { retryMatches, retryTitle } = await import("../src/lib/anime/search");

const preview = (name: string, genres?: string[]) => ({ id: `tt${name.length}`, type: "series", name, genres });
const card = (romaji: string, english?: string) => ({ id: romaji.length, title: { romaji, english, native: undefined } }) as never;

describe("a search AniList finds nothing for is asked again by a catalog's title (re-test 28)", () => {
  test("an animated result comes first", () => {
    expect(retryTitle([preview("Made Up Drama", ["Drama"]), preview("Made Up Toon", ["Animation"])], [])).toBe("Made Up Toon");
  });

  test("results without genres (catalog search answers carry none): the first show, then the first film", () => {
    expect(retryTitle([preview("Made Up Show"), preview("Other Show")], [preview("Made Up Film")])).toBe("Made Up Show");
    expect(retryTitle([], [preview("Made Up Film")])).toBe("Made Up Film");
    expect(retryTitle([], [])).toBeUndefined();
  });

  test("a guessed title only brings entries named like it, so a live-action show's name doesn't pull in some anime", () => {
    const found = [card("Made Up Show"), card("Made Up Show Season 2"), card("Something Else", "Unrelated")];
    expect(retryMatches(found, "Made Up Show").map((c: { id: number }) => c.id)).toEqual([12, 21]);
    expect(retryMatches([card("Kaiju no Hanashi", "Made-Up Show!")], "made up show")).toHaveLength(1);
  });
});
