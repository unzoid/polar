import { expect, test } from "bun:test";
import { isVideoAddress, openPage, pageName, titleFromAddress, titleFromLinks, togetherPage, VIDEO_PATTERNS, youtubeVideo } from "../src/ids";

// What the extension reads from a page's address (#208). Made-up ids throughout.

test("a database's title page gives the title; IMDb says through og:type whether it's a film or a show", () => {
  expect(titleFromAddress("https://www.imdb.com/title/tt0000001/", "video.movie")).toEqual({ db: "imdb", type: "movie", id: "tt0000001" });
  expect(titleFromAddress("https://m.imdb.com/title/tt0000002/?ref_=nv_sr_1", "video.tv_show")).toEqual({ db: "imdb", type: "series", id: "tt0000002" });
  expect(titleFromAddress("https://www.imdb.com/fr/title/tt0000001/", "video.movie")).toEqual({ db: "imdb", type: "movie", id: "tt0000001" });
  expect(titleFromAddress("https://www.themoviedb.org/movie/603-an-open-film", null)).toEqual({ db: "tmdb", type: "movie", id: 603 });
  expect(titleFromAddress("https://www.themoviedb.org/tv/1399?language=fr", null)).toEqual({ db: "tmdb", type: "series", id: 1399 });
  expect(titleFromAddress("https://anilist.co/anime/21/Some-Show/")).toEqual({ db: "anilist", id: 21 });
  expect(titleFromAddress("https://anilist.co/anime/21")).toEqual({ db: "anilist", id: 21 });
  expect(titleFromAddress("https://myanimelist.net/anime/5114/Some_Show")).toEqual({ db: "mal", id: 5114 });
});

test("lists, searches, people, sub-pages, episodes and lookalike hosts get no button", () => {
  for (const [href, og] of [
    ["https://www.imdb.com/title/tt0000001/", "video.episode"],
    ["https://www.imdb.com/title/tt0000001/", null],
    ["https://www.imdb.com/title/tt0000001/fullcredits", "video.movie"],
    ["https://www.imdb.com/chart/top/", "video.movie"],
    ["https://www.imdb.com/list/ls000000001/", null],
    ["https://www.imdb.com/fr/chart/top/", "video.movie"],
    ["https://www.imdb.com/name/nm0000001/", null],
    ["https://www.themoviedb.org/movie", null],
    ["https://www.themoviedb.org/movie/603-an-open-film/cast", null],
    ["https://www.themoviedb.org/person/1-someone", null],
    ["https://www.themoviedb.org/tv/1399/season/1", null],
    ["https://anilist.co/search/anime", null],
    ["https://anilist.co/anime/21/Some-Show/characters", null],
    ["https://anilist.co/manga/30013/", null],
    ["https://myanimelist.net/topanime.php", null],
    ["https://myanimelist.net/anime/5114/Some_Show/episode", null],
    ["https://myanimelist.net/anime/season", null],
    ["https://imdb.com.example.com/title/tt0000001/", "video.movie"],
    ["https://example.com/anime/21", null],
    ["ftp://www.imdb.com/title/tt0000001/", "video.movie"],
    ["not a link", null],
  ] as const) {
    expect(titleFromAddress(href, og)).toBeNull();
  }
});

test("Trakt and Letterboxd title pages give the title through their links to IMDb and TMDB", () => {
  const links = ["https://www.imdb.com/title/tt0000003/", "https://www.themoviedb.org/movie/42"];
  expect(titleFromLinks("https://trakt.tv/movies/an-open-film-2008", links)).toEqual({ db: "imdb", type: "movie", id: "tt0000003" });
  expect(titleFromLinks("https://app.trakt.tv/shows/a-made-up-show", ["https://www.themoviedb.org/tv/77"])).toEqual({ db: "tmdb", type: "series", id: 77 });
  expect(titleFromLinks("https://letterboxd.com/film/an-open-film/", links)).toEqual({ db: "imdb", type: "movie", id: "tt0000003" });
  expect(titleFromLinks("https://letterboxd.com/film/a-mini-series/", ["https://www.themoviedb.org/tv/88/"])).toEqual({ db: "tmdb", type: "series", id: 88 });
  // A page with neither link, a list, a person, a member's page: no button.
  expect(titleFromLinks("https://letterboxd.com/film/an-open-film/", ["https://example.com/"])).toBeNull();
  for (const href of [
    "https://trakt.tv/movies/trending",
    "https://app.trakt.tv/shows/popular","https://trakt.tv/users/someone/lists/x", "https://trakt.tv/shows/a-made-up-show/seasons/1", "https://letterboxd.com/someone/list/x/", "https://letterboxd.com/film/an-open-film/reviews/", "https://www.imdb.com/title/tt0000003/"]) {
    expect(titleFromLinks(href, links)).toBeNull();
  }
});

test("Open in Polarity goes to the website's /watch page, which opens the app or offers the download", () => {
  expect(openPage({ db: "imdb", type: "series", id: "tt0000002" })).toBe("https://getpolar.app/watch/?type=series&id=tt0000002");
  expect(openPage({ db: "tmdb", type: "movie", id: 603 })).toBe("https://getpolar.app/watch/?type=movie&id=tmdb%3A603");
  expect(openPage({ db: "anilist", id: 21 })).toBe("https://getpolar.app/watch/?type=anime&id=anilist%3A21");
  expect(openPage({ db: "mal", id: 5114 })).toBe("https://getpolar.app/watch/?type=anime&id=mal%3A5114");
});

test("a YouTube video's page is a video; channels, playlists, searches and lookalikes aren't", () => {
  expect(youtubeVideo("https://www.youtube.com/watch?v=abc-DEF_123&t=42s")).toBe("abc-DEF_123");
  expect(youtubeVideo("https://m.youtube.com/watch?v=abc-DEF_123")).toBe("abc-DEF_123");
  expect(youtubeVideo("https://www.youtube.com/shorts/abc-DEF_123")).toBe("abc-DEF_123");
  expect(youtubeVideo("https://www.youtube.com/live/abc-DEF_123")).toBe("abc-DEF_123");
  expect(youtubeVideo("https://youtu.be/abc-DEF_123")).toBe("abc-DEF_123");
  for (const href of [
    "https://www.youtube.com/",
    "https://www.youtube.com/@somechannel",
    "https://www.youtube.com/playlist?list=PL0000",
    "https://www.youtube.com/results?search_query=x",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/shorts/abc-DEF_123/extra",
    "https://youtube.com.example.com/watch?v=abc-DEF_123",
  ]) {
    expect(youtubeVideo(href)).toBeNull();
  }
});

test("only direct links to video files and streams can be watched together from the menu", () => {
  for (const href of [
    "https://media.example.com/film.mp4",
    "https://media.example.com/film.MKV",
    "http://media.example.com/a/b.webm?x=1",
    "https://media.example.com/live/index.m3u8",
    "https://media.example.com/dash/manifest.mpd#t=5",
  ]) {
    expect(isVideoAddress(href)).toBe(true);
  }
  for (const href of [
    undefined,
    "https://media.example.com/watch.html",
    "https://media.example.com/film.mp4.html",
    "https://media.example.com/page?file=film.mp4",
    "https://user:pass@media.example.com/film.mp4",
    "file:///films/film.mp4",
    "blob:https://media.example.com/0000",
    `https://media.example.com/${"a".repeat(2048)}.mp4`,
  ]) {
    expect(isVideoAddress(href)).toBe(false);
  }
  expect(VIDEO_PATTERNS).toContain("*://*/*.mp4");
  expect(VIDEO_PATTERNS).toContain("*://*/*.M3U8?*");
  expect(VIDEO_PATTERNS).toHaveLength(20);
});

test("Watch together goes to the website's /party page with the video in the fragment, never the query", () => {
  const page = togetherPage("https://www.youtube.com/watch?v=abc-DEF_123", 75.8, "An open film - YouTube");
  const u = new URL(page);
  expect(u.origin + u.pathname).toBe("https://getpolar.app/party/");
  expect(u.search).toBe("");
  const q = new URLSearchParams(u.hash.slice(1));
  expect(Object.fromEntries(q)).toEqual({ u: "https://www.youtube.com/watch?v=abc-DEF_123", t: "75", n: "An open film" });
  expect(new URLSearchParams(new URL(togetherPage("https://media.example.com/film.mp4", Number.NaN)).hash.slice(1)).get("t")).toBe("0");
  expect(pageName(`  Two\nlines‮${"x".repeat(300)}`)).toBe(`Two lines${"x".repeat(191)}`);
});
