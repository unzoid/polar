import { describe, expect, test } from "bun:test";
import { deflateRawSync } from "node:zlib";
import {
  matchFilm,
  MAX_PICKED_BYTES,
  normaliseTitle,
  parseCsv,
  parseLetterboxdExport,
  pickMatch,
  planLetterboxdImport,
  readLetterboxdFiles,
  type LetterboxdFilm,
} from "../src/lib/library/letterboxdImport";
import { MAX_ENTRY_BYTES, zipText, ZipError } from "../src/lib/library/zipText";
import type { MetaPreview } from "../src/lib/types";

// An invented export, shaped like the files Letterboxd writes: made-up films, tt0000000-style ids, example.com links.

/** A ZIP as an archiver writes it: local headers, then the central directory and its end record. CRCs aren't checked. */
function zip(entries: { path: string; text?: string; bytes?: Uint8Array; store?: boolean; size?: number }[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.path);
    const raw = e.bytes ?? enc.encode(e.text ?? "");
    const body = e.store ? raw : new Uint8Array(deflateRawSync(raw));
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(8, e.store ? 0 : 8, true);
    local.setUint32(18, body.length, true);
    local.setUint32(22, raw.length, true);
    local.setUint16(26, name.length, true);
    locals.push(new Uint8Array(local.buffer), name, body);
    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(10, e.store ? 0 : 8, true);
    central.setUint32(20, body.length, true);
    central.setUint32(24, e.size ?? raw.length, true);
    central.setUint16(28, name.length, true);
    central.setUint32(42, offset, true);
    centrals.push(new Uint8Array(central.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const dirSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);
  const parts = [...locals, ...centrals, new Uint8Array(end.buffer)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) out.set(p, (at += p.length) - p.length);
  return out;
}

const WATCHED = `﻿Date,Name,Year,Letterboxd URI\r
2024-03-01,The Lantern Keepers,2001,https://boxd.example.com/a1\r
2024-03-02,"Night, Interrupted",1999,https://boxd.example.com/a2\r
2024-03-03,Amélie's Clockwork,2010,https://boxd.example.com/a3\r
`;
const DIARY = `Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date
2024-05-10,The Lantern Keepers,2001,https://boxd.example.com/d1,4,Yes,"rainy, home",2024-05-09
2024-01-10,The Lantern Keepers,2001,https://boxd.example.com/d2,4,,,2024-01-08
`;
const RATINGS = `Date,Name,Year,Letterboxd URI,Rating
2024-03-01,The Lantern Keepers,2001,https://boxd.example.com/a1,4.5
`;
const WATCHLIST = `Date,Name,Year,Letterboxd URI
2023-12-24,Paper Moons,1953,https://boxd.example.com/w1
2023-12-25,"The ""Quiet"" Harbour",,https://boxd.example.com/w2
`;

const noon = (s: string) => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d, 12).getTime();
};
const film = (id: string, name: string, year?: string): MetaPreview => ({ id, type: "movie", name, releaseInfo: year });

describe("CSV", () => {
  test("quoted fields keep commas, quotes and line breaks; the BOM and blank lines go", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\n\n1,\n')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"\nthere'],
      ["1", ""],
    ]);
  });
});

describe("titles", () => {
  test("accents, case, punctuation and & don't matter", () => {
    expect(normaliseTitle("Amélie's Clockwork")).toBe(normaliseTitle("AMELIE S CLOCKWORK"));
    expect(normaliseTitle("Night & Day: Part II")).toBe("night and day part ii");
  });
});

describe("reading the export", () => {
  test("files are joined by title and year; the latest watched date wins; the watchlist keeps its own date", () => {
    const exp = parseLetterboxdExport(
      new Map([
        ["watched.csv", WATCHED],
        ["diary.csv", DIARY],
        ["ratings.csv", RATINGS],
        ["watchlist.csv", WATCHLIST],
      ]),
    );
    expect(exp.unreadable).toBe(0);
    const by = new Map(exp.films.map((f) => [f.name, f]));
    expect(exp.films).toHaveLength(5);
    // The diary's Watched Date (not the day it was logged), the latest of all rows.
    expect(by.get("The Lantern Keepers")).toMatchObject({ year: 2001, watchedAt: noon("2024-05-09"), rating: 4.5 });
    expect(by.get("Night, Interrupted")).toMatchObject({ year: 1999, watchedAt: noon("2024-03-02") });
    expect(by.get("Paper Moons")).toMatchObject({ watchlistAt: noon("2023-12-24") });
    expect(by.get("Paper Moons")?.watchedAt).toBeUndefined();
    expect(by.get('The "Quiet" Harbour')?.year).toBeUndefined();
  });

  test("an IMDb column is kept where a file has one", () => {
    const exp = parseLetterboxdExport(new Map([["watched.csv", "Date,Name,Year,imdbID\n2024-01-01,Paper Moons,1953,tt0000042\n"]]));
    expect(exp.films[0].imdb).toBe("tt0000042");
  });

  test("files that aren't Letterboxd's are refused; rows without a title are counted", () => {
    expect(() => parseLetterboxdExport(new Map([["reviews.csv", WATCHED]]))).toThrow("isn't a Letterboxd export");
    expect(() => parseLetterboxdExport(new Map([["watched.csv", "Title,When\nx,y\n"]]))).toThrow("isn't a Letterboxd export");
    expect(parseLetterboxdExport(new Map([["watched.csv", "Date,Name,Year\n2024-01-01,,2000\n"]])).unreadable).toBe(1);
  });

  test("the ZIP is read on the device: its own files, the shallowest copy, not deleted/ or lists/", async () => {
    const bytes = zip([
      { path: "letterboxd-someone/", store: true },
      { path: "letterboxd-someone/watched.csv", text: WATCHED },
      { path: "letterboxd-someone/watchlist.csv", text: WATCHLIST, store: true },
      { path: "letterboxd-someone/deleted/watched.csv", text: "Date,Name,Year\n2020-01-01,Gone Film,2000\n" },
      { path: "letterboxd-someone/lists/favourites.csv", text: "Date,Name,Year\n2020-01-01,Listed Film,2000\n" },
      { path: "letterboxd-someone/reviews.csv", text: "Date,Name,Year\n2020-01-01,Reviewed Film,2000\n" },
    ]);
    const exp = await readLetterboxdFiles([{ name: "letterboxd-someone.zip", size: bytes.length, bytes: async () => bytes }]);
    expect(exp.films.map((f) => f.name).sort()).toEqual(["Amélie's Clockwork", "Night, Interrupted", "Paper Moons", "The \"Quiet\" Harbour", "The Lantern Keepers"]);
  });

  test("the CSV files can be picked one by one instead", async () => {
    const enc = new TextEncoder();
    const exp = await readLetterboxdFiles([
      { name: "watchlist.csv", size: WATCHLIST.length, bytes: async () => enc.encode(WATCHLIST) },
      { name: "ratings.csv", size: RATINGS.length, bytes: async () => enc.encode(RATINGS) },
    ]);
    expect(exp.films).toHaveLength(3);
    // A file far larger than any export isn't read at all.
    let read = false;
    const huge = { name: "watched.csv", size: MAX_PICKED_BYTES + 1, bytes: async () => ((read = true), new Uint8Array(0)) };
    await expect(readLetterboxdFiles([huge])).rejects.toThrow("too large");
    expect(read).toBe(false);
  });
});

describe("ZIP limits", () => {
  test("not a ZIP, damaged, or an entry bigger than it says: refused", async () => {
    await expect(zipText(new TextEncoder().encode("Date,Name\n"), () => true)).rejects.toThrow(ZipError);
    const good = zip([{ path: "watched.csv", text: WATCHED }]);
    const damaged = good.slice();
    damaged[0] = 0; // the local header's signature
    await expect(zipText(damaged, () => true)).rejects.toThrow("damaged");
    // Inflates to 100 kB while the directory claims 10 bytes.
    const bomb = zip([{ path: "watched.csv", bytes: new Uint8Array(100_000), size: 10 }]);
    await expect(zipText(bomb, () => true)).rejects.toThrow("larger than it says");
    const huge = zip([{ path: "watched.csv", text: "x", size: MAX_ENTRY_BYTES + 1 }]);
    await expect(zipText(huge, () => true)).rejects.toThrow("too large");
    // Entries nobody asked for aren't inflated at all.
    expect((await zipText(huge, () => false)).size).toBe(0);
  });
});

describe("matching", () => {
  const lantern: LetterboxdFilm = { key: "k", name: "The Lantern Keepers", year: 2001 };

  test("one film with the same title and year is taken", () => {
    const m = pickMatch(lantern, [film("tt0000001", "The Lantern Keepers", "2001"), film("tt0000002", "The Lantern Keepers", "1972")]);
    expect(m).toEqual({ found: film("tt0000001", "The Lantern Keepers", "2001") });
  });

  test("a year off is taken when it is the only one", () => {
    expect(pickMatch(lantern, [film("tt0000003", "The Lantern-Keepers", "2002")])).toMatchObject({ found: { id: "tt0000003" } });
  });

  test("two of the same title and year, or nothing close: the user picks", () => {
    const twins = [film("tt0000001", "The Lantern Keepers", "2001"), film("tt0000004", "The Lantern Keepers", "2001")];
    expect(pickMatch(lantern, twins)).toEqual({ choose: twins });
    // A year off either way: two near films, none taken.
    expect(pickMatch(lantern, [film("tt0000005", "The Lantern Keepers", "2000"), film("tt0000006", "The Lantern Keepers", "2002")])).toMatchObject({
      choose: [{ id: "tt0000005" }, { id: "tt0000006" }],
    });
    // Another title of that year is offered, never taken.
    expect(pickMatch(lantern, [film("tt0000007", "Lanterns", "2001"), film("tt0000008", "Lanterns", "1980")])).toEqual({
      choose: [film("tt0000007", "Lanterns", "2001")],
    });
    expect(pickMatch(lantern, [])).toEqual({ choose: [] });
  });

  test("shows and other catalogs' ids are never matched", () => {
    expect(pickMatch(lantern, [{ ...film("tt0000001", "The Lantern Keepers", "2001"), type: "series" }, film("x:1", "The Lantern Keepers", "2001")])).toEqual({ choose: [] });
  });

  test("searches narrowed to the year first, the plain search only when that settles nothing; IMDb ids need no search", async () => {
    const asked: [string, number | undefined][] = [];
    const search = async (q: string, year?: number) => {
      asked.push([q, year]);
      return year ? [] : [film("tt0000003", "The Lantern Keepers", "2002")];
    };
    expect(await matchFilm(lantern, search)).toMatchObject({ found: { id: "tt0000003" } });
    expect(asked).toEqual([
      ["The Lantern Keepers", 2001],
      ["The Lantern Keepers", undefined],
    ]);
    asked.length = 0;
    expect(await matchFilm({ ...lantern, imdb: "tt0000009" }, search)).toMatchObject({ found: { id: "tt0000009", type: "movie" } });
    expect(asked).toEqual([]);
  });
});

describe("planning", () => {
  test("watchlist to the library, watched films marked watched, one entry per film", () => {
    const films: LetterboxdFilm[] = [
      { key: "a", name: "Paper Moons", year: 1953, watchlistAt: 100 },
      { key: "b", name: "The Lantern Keepers", year: 2001, watchedAt: 300, rating: 4 },
      // Another row the user matched to the same film, watched earlier.
      { key: "c", name: "Lantern Keepers", year: 2001, watchedAt: 200 },
      { key: "d", name: "Not Found", year: 2000, watchedAt: 50 },
    ];
    const matched = new Map([
      ["a", film("tt0000010", "Paper Moons", "1953")],
      ["b", film("tt0000001", "The Lantern Keepers", "2001")],
      ["c", film("tt0000001", "The Lantern Keepers", "2001")],
    ]);
    const plan = planLetterboxdImport(films, matched, { watchlist: true, watched: true });
    expect(plan.library).toEqual([{ id: "tt0000010", type: "movie", name: "Paper Moons", poster: undefined, addedAt: 100 }]);
    expect(plan.progress).toHaveLength(1);
    expect(plan.progress[0]).toMatchObject({ metaId: "tt0000001", videoId: "tt0000001", position: 1, duration: 1, updatedAt: 300 });
    expect(planLetterboxdImport(films, matched, { watchlist: false, watched: true }).library).toEqual([]);
    expect(planLetterboxdImport(films, matched, { watchlist: true, watched: false }).progress).toEqual([]);
  });
});
