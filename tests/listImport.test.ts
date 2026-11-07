import "./storageStub";
import { expect, test } from "bun:test";
import type { AniZip } from "../src/lib/anime/anizip";
import { readEntry } from "../src/lib/lists/anilistList";
import type { ListEntry } from "../src/lib/lists/entry";
import { planListImport, previewList, watchedOf, type ListImportDeps } from "../src/lib/lists/listImport";
import type { Meta, Video } from "../src/lib/types";

const entry = (over: Partial<ListEntry>): ListEntry => ({
  id: 1,
  mediaId: 100,
  status: "CURRENT",
  progress: 0,
  score: 0,
  repeat: 0,
  updatedAt: 2_000_000,
  episodes: 12,
  format: "TV",
  title: "Lanternfield",
  ...over,
});

const videos = (season: number, n: number, firstDay: number): Video[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `tt0000001:${season}:${i + 1}`,
    title: `Episode ${i + 1}`,
    season,
    episode: i + 1,
    released: new Date(Date.UTC(2020, 0, firstDay + 7 * i)).toISOString().slice(0, 10),
  }));

const show: Meta = { id: "tt0000001", type: "series", name: "Lanternfield (IMDb)", videos: [...videos(1, 12, 1), ...videos(2, 12, 200)] } as Meta;

/** ani.zip for an entry of the IMDb show: its episodes air with season `season`'s. */
const zip = (imdb: string | null, season: number, firstDay: number, kitsu?: number): AniZip => ({
  mappings: { imdb_id: imdb, kitsu_id: kitsu },
  episodes: Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      String(i + 1),
      { episode: String(i + 1), seasonNumber: season, episodeNumber: i + 1, airDate: new Date(Date.UTC(2020, 0, firstDay + 7 * i)).toISOString().slice(0, 10) },
    ]),
  ),
});

function deps(over: Partial<ListImportDeps> = {}): ListImportDeps {
  return {
    idKey: "anilist",
    links: async () => [],
    listed: async (anilist) => (anilist === 100 || anilist === 200 ? { imdb_id: "tt0000001" } : null),
    aniZip: async (anilist) => (anilist === 100 ? zip("tt0000001", 1, 1) : anilist === 200 ? zip("tt0000001", 2, 200) : null),
    meta: async (_, id) => (id === "tt0000001" ? show : null),
    ...over,
  };
}

test("the list read for the import keeps the entry's format, title, cover and when it was added", () => {
  const e = readEntry({
    id: 3,
    mediaId: 9,
    status: "PLANNING",
    updatedAt: 5,
    createdAt: 4,
    media: {
      episodes: null,
      isAdult: true,
      format: "MOVIE",
      title: { english: null, romaji: "Asagiri Teishajo" },
      coverImage: { large: "https://img.example.com/c.jpg" },
    },
  });
  expect(e).toMatchObject({ format: "MOVIE", title: "Asagiri Teishajo", poster: "https://img.example.com/c.jpg", createdAt: 4, episodes: null, isAdult: true });
});

test("watched episodes: the progress, all of them once completed; a film once finished or watched again", () => {
  expect(watchedOf(entry({ progress: 5 }))).toBe(5);
  expect(watchedOf(entry({ status: "COMPLETED", progress: 0 }))).toBe(12);
  expect(watchedOf(entry({ status: "COMPLETED", progress: 0, episodes: null }))).toBe(0);
  expect(watchedOf(entry({ status: "PLANNING" }))).toBe(0);
  expect(watchedOf(entry({ format: "MOVIE", status: "COMPLETED" }))).toBe(1);
  expect(watchedOf(entry({ format: "MOVIE", status: "PLANNING" }))).toBe(0);
});

test("the preview leaves adult entries out unless the account shows them", () => {
  const list = [
    entry({ progress: 3 }),
    entry({ id: 2, mediaId: 7, isAdult: true, progress: 2 }),
    entry({ id: 3, mediaId: 8, format: "MOVIE", status: "COMPLETED" }),
  ];
  expect(previewList(list, false)).toMatchObject({ films: 1, shows: 1, watched: 4, adult: 1 });
  expect(previewList(list, false).entries.map((e) => e.mediaId)).toEqual([100, 8]);
  expect(previewList(list, true)).toMatchObject({ films: 1, shows: 2, watched: 6, adult: 0 });
});

test("each season's entry marks its own episodes of the one IMDb show, which goes into the library once", async () => {
  const list = [entry({ progress: 3, createdAt: 1_000 }), entry({ id: 2, mediaId: 200, progress: 2, createdAt: 900, updatedAt: 3_000_000 })];
  const plan = await planListImport(list, { library: true, watched: true }, deps());
  expect(plan.library).toEqual([{ id: "tt0000001", type: "series", name: "Lanternfield", poster: undefined, addedAt: 900_000 }]);
  expect(plan.progress.map((p) => p.videoId).sort()).toEqual(["tt0000001:1:1", "tt0000001:1:2", "tt0000001:1:3", "tt0000001:2:1", "tt0000001:2:2"]);
  const first = plan.progress.filter((p) => p.videoId.startsWith("tt0000001:1:")).sort((a, b) => a.updatedAt - b.updatedAt);
  // Finished in order, just before the entry last changed.
  expect(first.map((p) => p.videoId)).toEqual(["tt0000001:1:1", "tt0000001:1:2", "tt0000001:1:3"]);
  expect(first.every((p) => p.updatedAt < 2_000_000_000 && p.position === p.duration && p.metaId === "tt0000001")).toBe(true);
  expect(plan).toMatchObject({ unlinked: 0, unmatched: 0 });
});

test("a stored link wins, an entry only ani.zip knows plays from its Kitsu id, one nobody knows is counted", async () => {
  const kitsuShow: Meta = {
    id: "kitsu:55",
    type: "series",
    name: "Bellwether",
    videos: [1, 2, 3].map((n) => ({ id: `kitsu:55:${n}`, title: `Episode ${n}`, season: 1, episode: n })),
  } as Meta;
  const d = deps({
    links: async () => [{ anilist: 300, canonical: "tt0000009", updatedAt: 1 }],
    aniZip: async (a) => (a === 400 ? zip(null, 1, 1, 55) : null),
    meta: async (_, id) => (id === "kitsu:55" ? kitsuShow : null),
  });
  const list = [entry({ mediaId: 300, title: "Stored" }), entry({ id: 2, mediaId: 400, title: "Bellwether", progress: 2 }), entry({ id: 3, mediaId: 500 })];
  const plan = await planListImport(list, { library: true, watched: true }, d);
  expect(plan.library.map((i) => i.id).sort()).toEqual(["kitsu:55", "tt0000009"]);
  expect(plan.progress.map((p) => p.videoId)).toEqual(["kitsu:55:1", "kitsu:55:2"]);
  expect(plan.unlinked).toBe(1);
});

test("films are watched under their own id; episodes that can't be found are counted, not guessed", async () => {
  const d = deps({ listed: async (a) => (a === 600 ? { imdb_id: "tt0000002" } : a === 700 ? { imdb_id: "tt0000003" } : null), meta: async () => null });
  const list = [entry({ mediaId: 600, format: "MOVIE", status: "COMPLETED" }), entry({ id: 2, mediaId: 700, progress: 4 })];
  const plan = await planListImport(list, { library: false, watched: true }, d);
  expect(plan.library).toEqual([]);
  expect(plan.progress).toEqual([
    { metaId: "tt0000002", videoId: "tt0000002", type: "movie", name: "Lanternfield", poster: undefined, position: 1, duration: 1, updatedAt: 2_000_000_000 },
  ]);
  expect(plan.unmatched).toBe(1);
});

test("library only: no metadata is read, and the step counts every entry", async () => {
  let metas = 0;
  const steps: string[] = [];
  const d = deps({ meta: async () => (metas++, show), step: (n, of) => void steps.push(`${n}/${of}`) });
  const plan = await planListImport([entry({ progress: 3 }), entry({ id: 2, mediaId: 999 })], { library: true, watched: false }, d);
  expect(metas).toBe(0);
  expect(plan.progress).toEqual([]);
  expect(plan.library.map((i) => i.id)).toEqual(["tt0000001"]);
  expect(steps).toEqual(["1/2", "2/2"]);
});

test("the Settings row says what the list holds and what the import skipped", async () => {
  const { previewText, summaryText } = await import("../src/components/settings/ListImport");
  expect(previewText({ shows: 12, films: 0, watched: 140, adult: 0 })).toBe("12 shows on your list, 140 episodes watched.");
  expect(previewText({ shows: 1, films: 2, watched: 3, adult: 1 }, "AniList")).toBe(
    "1 show and 2 films on your list, 3 episodes and films watched. 1 adult entry left out: your AniList account hides them.",
  );
  expect(previewText({ shows: 1, films: 0, watched: 3, adult: 2 })).toBe("1 show on your list, 3 episodes watched. 2 adult entries left out.");
  expect(previewText({ shows: 0, films: 0, watched: 0, adult: 0 })).toBe("Your list is empty.");
  expect(summaryText({ library: 2, progress: 1, unlinked: 0, unmatched: 0 })).toBe("Added 2 titles to your library and 1 watched episode.");
  expect(summaryText({ library: 0, progress: 0, unlinked: 3, unmatched: 1 })).toBe(
    "Added 0 titles to your library and 0 watched episodes. Skipped 3 entries Polarity can't play from and the watched episodes of 1 entry that couldn't all be matched.",
  );
});
