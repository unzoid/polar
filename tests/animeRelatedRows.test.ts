import { describe, expect, test } from "bun:test";
import type { Anime, ChainLink, MediaFormat, RelationType } from "../src/lib/anime/anilist";
import type { FranchiseTabs, RelatedRows } from "../src/lib/anime/relatedRows";

// The labels come from lib/anime/format, which reads Settings → Anime from storage.
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const { relatedRows } = await import("../src/lib/anime/relatedRows");
const { walkSeasons } = await import("../src/lib/anime/seasons");

// An invented franchise, Lantern Coast, in watch order: two TV seasons with an OVA between them, a film
// on the chain, a third season; off the chain, a side-story film, a spin-off and the manga.
type Made = { id: number; format: MediaFormat; episodes: number | null; type?: "ANIME" | "MANGA"; year: number };
const S1: Made = { id: 1, format: "TV", episodes: 12, year: 2001 };
const OVA: Made = { id: 2, format: "OVA", episodes: 1, year: 2002 };
const S2: Made = { id: 3, format: "TV", episodes: 12, year: 2003 };
const FILM: Made = { id: 4, format: "MOVIE", episodes: 1, year: 2004 };
const S3: Made = { id: 5, format: "TV", episodes: 12, year: 2005 };
const SIDE_FILM: Made = { id: 6, format: "MOVIE", episodes: 1, year: 2004 };
const SPIN_OFF: Made = { id: 7, format: "ONA", episodes: 10, year: 2006 };
const MANGA: Made = { id: 8, format: "MANGA", episodes: null, type: "MANGA", year: 2000 };
const CHAIN = [S1, OVA, S2, FILM, S3];

const card = (m: Made) => ({
  id: m.id,
  type: m.type ?? "ANIME",
  format: m.format,
  episodes: m.episodes,
  seasonYear: m.year,
  title: { romaji: `Lantern Coast ${m.id}`, english: null, native: null },
  coverImage: {},
});

function link(m: Made): ChainLink {
  const i = CHAIN.indexOf(m);
  const edges: ChainLink["relations"]["edges"] = [];
  if (i > 0) edges.push({ relationType: "PREQUEL", node: { id: CHAIN[i - 1].id, type: "ANIME", format: CHAIN[i - 1].format } });
  if (i >= 0 && i < CHAIN.length - 1) edges.push({ relationType: "SEQUEL", node: { id: CHAIN[i + 1].id, type: "ANIME", format: CHAIN[i + 1].format } });
  return { ...card(m), relations: { edges } } as unknown as ChainLink;
}

/** An entry's own page data: its neighbours on the chain and everything else in the franchise. */
function page(m: Made): Anime {
  const i = CHAIN.indexOf(m);
  const rel = (relationType: RelationType, n: Made) => ({ relationType, node: card(n) });
  const edges = [
    ...(i > 0 ? [rel("PREQUEL", CHAIN[i - 1])] : []),
    ...(i >= 0 && i < CHAIN.length - 1 ? [rel("SEQUEL", CHAIN[i + 1])] : []),
    ...CHAIN.filter((c) => c !== m && Math.abs(CHAIN.indexOf(c) - i) > 1).map((c) => rel("OTHER", c)),
    rel("SIDE_STORY", SIDE_FILM),
    rel("SPIN_OFF", SPIN_OFF),
    rel("SOURCE", MANGA),
  ];
  return { ...card(m), relations: { edges }, recommendations: { nodes: [] } } as unknown as Anime;
}

async function grouped(active: Made): Promise<FranchiseTabs> {
  const walk = await walkSeasons(link(active), async (id) => link(CHAIN.find((c) => c.id === id)!));
  return { seasons: walk.seasons, order: walk.order, active: active.id };
}

const ids = (cards: RelatedRows["also"]) => cards.map((c) => c.card.id);

/** The check #193 asks for: no card that opens a page opens this one (any of its tabs). */
function noCardLeadsBack(rows: RelatedRows, f: FranchiseTabs) {
  const tabs = new Set(f.seasons.map((s) => s.card.id));
  for (const c of [...rows.watchOrder, ...rows.also]) if (!c.tab) expect(tabs.has(c.card.id)).toBe(false);
  for (const c of rows.also) expect(c.tab).toBeUndefined();
}

describe("Watch Order and Also in This Franchise on a franchise page (#193)", () => {
  test("Watch Order is the whole chain in order, this page's tabs switching tabs and the one on screen marked", async () => {
    const f = await grouped(S2);
    expect(f.seasons.map((s) => s.card.id)).toEqual([1, 3, 4, 5]);
    const rows = relatedRows(page(S2), f);
    expect(rows.watchOrder.map((c) => [c.card.id, c.label, !!c.tab, !!c.current])).toEqual([
      [1, "Season 1", true, false],
      [2, "OVA · 2002", false, false],
      [3, "Season 2 · Now showing", true, true],
      [4, "Movie", true, false],
      [5, "Season 3", true, false],
    ]);
    noCardLeadsBack(rows, f);
  });

  test("Also in This Franchise holds only what the page doesn't: the side-story film, the spin-off, the manga", async () => {
    for (const at of [S1, S2, FILM, S3]) {
      const f = await grouped(at);
      const rows = relatedRows(page(at), f);
      expect(ids(rows.also)).toEqual([SIDE_FILM.id, SPIN_OFF.id, MANGA.id]);
      noCardLeadsBack(rows, f);
    }
  });

  test("an order of this page's tabs alone shows no Watch Order row; nothing left shows no Also row", () => {
    const only = (m: Made): Anime => ({
      ...page(m),
      relations: { edges: page(m).relations.edges.filter((e) => e.node.id !== OVA.id && [1, 3].includes(e.node.id)) },
    });
    const f: FranchiseTabs = {
      seasons: [
        { card: card(S1) as never, label: "Season 1" },
        { card: card(S2) as never, label: "Season 2" },
      ],
      order: [card(S1) as never, card(S2) as never],
      active: S1.id,
    };
    const rows = relatedRows(only(S1), f);
    expect(rows).toEqual({ watchOrder: [], also: [] });
  });

  test("while the chain is still being walked, no Watch Order yet and no prequel or sequel that may become a tab", () => {
    const f: FranchiseTabs = { seasons: [{ card: card(S2) as never, label: "Lantern Coast 3" }], active: S2.id, loading: true };
    const rows = relatedRows(page(S2), f);
    expect(rows.watchOrder).toEqual([]);
    expect(ids(rows.also)).not.toContain(OVA.id);
    expect(ids(rows.also)).not.toContain(FILM.id);
    noCardLeadsBack(rows, f);
  });

  test("seasons as separate shows (#22): both rows list the other entries from the entry's own relations, as before", () => {
    const rows = relatedRows(page(S2));
    expect(ids(rows.watchOrder)).toEqual([OVA.id, FILM.id]);
    expect(rows.watchOrder.map((c) => c.label)).toEqual(["Prequel · OVA · 2002", "Sequel · Movie · 2004"]);
    expect(ids(rows.also)).toEqual([SIDE_FILM.id, SPIN_OFF.id, S1.id, S3.id, MANGA.id]);
    expect([...rows.watchOrder, ...rows.also].some((c) => c.card.id === S2.id || c.tab)).toBe(false);
  });
});
