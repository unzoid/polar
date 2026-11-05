import { expect, test } from "bun:test";
import type { Anime, AnimeCard } from "../src/lib/anime/anilist";
import type { AniZip } from "../src/lib/anime/anizip";
import { animeEpisodes, progressByVideo, upNext, upNextLabel, type AnimeEpisode } from "../src/lib/anime/episodes";
import { distinctLabels } from "../src/lib/anime/seasonLabels";
import type { Progress, Video } from "../src/lib/types";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const show = (over: Partial<AnimeCard> = {}) => ({ id: 1, format: "TV", episodes: 3, ...over }) as AnimeCard;
const video = (episode: number, released: string, season = 1): Video => ({ id: `tt1:${season}:${episode}`, title: `E${episode}`, season, episode, released });
const zip = (eps: [number, string][], imdb = "tt1"): AniZip => ({
  mappings: { imdb_id: imdb, kitsu_id: 7 },
  episodes: Object.fromEntries(eps.map(([n, d]) => [String(n), { episode: String(n), airDateUtc: d, title: { en: `Ep ${n}` } }])),
});
const progress = (videoId: string, position: number, updatedAt: number, duration = 1440) => ({ videoId, position, duration, updatedAt }) as Progress;

test("ani.zip's episodes are matched to the IMDb show's videos by air date", () => {
  const videos = [video(1, "2026-10-01"), video(2, "2026-10-08")];
  const eps = animeEpisodes({
    anime: show(),
    zip: zip([
      [1, "2026-10-01T15:00:00Z"],
      [2, "2026-10-08T15:00:00Z"],
      [3, "2026-11-20T15:00:00Z"],
    ]),
    videos,
    imdb: "tt1",
    titles: "english",
    now: NOW,
  });
  expect(eps.map((e) => [e.number, e.video?.id, e.upcoming, e.title])).toEqual([
    [1, "tt1:1:1", false, "Ep 1"],
    [2, "tt1:1:2", false, "Ep 2"],
    [3, undefined, true, "Ep 3"],
  ]);
});

test("without ani.zip a Kitsu show's videos are taken by number", () => {
  const videos: Video[] = [1, 2].map((n) => ({ id: `kitsu:7:${n}`, title: "", season: 1, episode: n }));
  const eps = animeEpisodes({ anime: show({ episodes: 2 }), zip: null, videos, titles: "english", now: NOW });
  expect(eps.map((e) => e.video?.id)).toEqual(["kitsu:7:1", "kitsu:7:2"]);
});

test("AniList's schedule adds what ani.zip doesn't list yet", () => {
  const anime = { ...show(), airingSchedule: { nodes: [{ episode: 2, airingAt: Date.parse("2026-11-11T15:00:00Z") / 1000 }] } } as unknown as Anime;
  const eps = animeEpisodes({ anime, zip: zip([[1, "2026-11-01T15:00:00Z"]]), videos: [], imdb: "tt1", titles: "english", now: NOW });
  expect(eps.map((e) => [e.number, e.upcoming])).toEqual([
    [1, false],
    [2, true],
  ]);
});

test("films have no episodes", () => {
  expect(animeEpisodes({ anime: show({ format: "MOVIE" }), zip: null, videos: [], titles: "english" })).toEqual([]);
});

const ep = (n: number, upcoming = false): AnimeEpisode => ({ number: n, upcoming, video: upcoming ? undefined : video(n, "") });
const eps = [ep(1), ep(2), ep(3), ep(4, true)];

test("progress under the Kitsu id counts for the IMDb episode, newest wins", () => {
  const m = progressByVideo([progress("kitsu:7:2", 100, 5), progress("tt1:1:2", 50, 3)], { episodes: eps, imdb: "tt1", kitsu: 7, isMovie: false });
  expect(m.get("tt1:1:2")?.position).toBe(100);
  const older = progressByVideo([progress("kitsu:7:2", 100, 1), progress("tt1:1:2", 50, 3)], { episodes: eps, imdb: "tt1", kitsu: 7, isMovie: false });
  expect(older.get("tt1:1:2")?.position).toBe(50);
});

test("up next: start, resume, replay a barely started one, then the one after a finished one", () => {
  const next = (p: Progress[]) => upNext({ episodes: eps, byVideo: new Map(p.map((x) => [x.videoId, x])), isMovie: false, metaId: "tt1", watched: 0.9 });
  expect(next([])).toMatchObject({ kind: "start", ep: { number: 1 } });
  expect(next([progress("tt1:1:2", 600, 1)])).toMatchObject({ kind: "resume", resumeAt: 600, ep: { number: 2 } });
  expect(next([progress("tt1:1:2", 10, 1)])).toMatchObject({ kind: "next", ep: { number: 2 } });
  expect(next([progress("tt1:1:2", 1400, 1)])).toMatchObject({ kind: "next", ep: { number: 3 } });
  // The last aired one finished: back to the start (episode 4 hasn't aired).
  expect(next([progress("tt1:1:3", 1400, 1)])).toMatchObject({ kind: "start", ep: { number: 1 } });
});

test("up next for a film, and the Play button's words", () => {
  const film = upNext({ episodes: [], byVideo: new Map([["tt9", progress("tt9", 754, 1, 6000)]]), isMovie: true, metaId: "tt9", watched: 0.9 });
  expect(film).toEqual({ resumeAt: 754, kind: "resume" });
  expect(upNextLabel(film, true)).toBe("Resume · 12:34");
  expect(upNextLabel({ kind: "start", ep: ep(1) }, false)).toBe("Play First Episode");
  expect(upNextLabel({ kind: "resume", ep: ep(5), resumeAt: 60 }, false)).toBe("Resume Episode 5");
  expect(upNextLabel({ kind: "start" }, false)).toBe("Play");
});

test("season tabs name what tells the entries apart", () => {
  expect(
    distinctLabels(
      ["Tower of Glass", "Tower of Glass Season 2", "Tower of Glass Season 3 Part 2", "Tower of Glass"],
      ["Season 1", "Season 2", "Season 3", "Season 4"],
    ),
  ).toEqual(["Season 1", "Season 2", "Season 3 Part 2", "Season 4"]);
  expect(
    distinctLabels(["Paleblade", "Paleblade: Hundred-Night Ash War", "Paleblade: Hundred-Night Ash War - The Parting"], ["Season 1", "Season 2", "Season 3"]),
  ).toEqual(["Season 1", "Hundred-Night Ash War", "The Parting"]);
});

test("season tabs keep their context (test report 1, items 9 and 19)", () => {
  // Hayato shares no words with "Kazeori" at the start: its own title, not "Season 3".
  expect(
    distinctLabels(
      ["Kazeori", "Kazeori: Arashi-hen", "Hayato: Kazeori Next Generations", "HAYATO: TWO RED TIDES"],
      ["Season 1", "Season 2", "Season 3", "Season 4"],
    ),
  ).toEqual(["Season 1", "Arashi-hen", "Hayato: Kazeori Next Generations", "HAYATO: TWO RED TIDES"]);
  // A later part keeps its arc's name when what's left would be only a part or number.
  const ds = [
    ["Ember Hunter: Hikari no Tsurugi", "Hikari no Tsurugi"],
    ["Ember Hunter: Hikari no Tsurugi Endless Keep", "Hikari no Tsurugi: Mugenkyo-hen"],
    ["Ember Hunter: Hikari no Tsurugi Endless Keep Part 2", "Hikari no Tsurugi: Mugenkyo-hen Part 2"],
    // No English title yet: matched in its own language (romaji with romaji).
    ["Hikari no Tsurugi: Mugenkyo-hen Movie 3", "Hikari no Tsurugi: Mugenkyo-hen Movie 3"],
  ];
  expect(distinctLabels(ds, ["Season 1", "Movie", "Movie", "Movie"])).toEqual([
    "Season 1",
    "Endless Keep",
    "Endless Keep Part 2",
    "Mugenkyo-hen Movie 3",
  ]);
  // The Parting still drops what it shares with Hundred-Night Ash War (not only a part).
  expect(
    distinctLabels(["Paleblade", "Paleblade: Hundred-Night Ash War", "Paleblade: Hundred-Night Ash War - The Parting"], ["Season 1", "Season 2", "Season 3"]),
  ).toEqual(["Season 1", "Hundred-Night Ash War", "The Parting"]);
});
