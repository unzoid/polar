import { expect, test } from "bun:test";
import type { AnimeCard } from "../src/lib/anime/anilist";

// The labels come from lib/anime/format, which reads Settings → Anime from storage.
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const { entryAction, entryKind, youtubeVideoId } = await import("../src/lib/anime/franchiseEntry");

// Made-up entries of an invented franchise.
const card = (over: Partial<AnimeCard>) =>
  ({ id: 920001, idMal: null, type: "ANIME", format: "TV", title: { english: "Lantern Bay" }, coverImage: {}, ...over }) as AnimeCard;
const yt = (url: string) => [{ site: "YouTube", url }];

test("youtubeVideoId reads watch, share, embed and Shorts links, nothing else", () => {
  expect(youtubeVideoId("https://www.youtube.com/watch?v=AAAAAAAAAAA")).toBe("AAAAAAAAAAA");
  expect(youtubeVideoId("https://youtu.be/BBBBBBBBBBB?t=3")).toBe("BBBBBBBBBBB");
  expect(youtubeVideoId("https://www.youtube.com/embed/CCCCCCCCCCC")).toBe("CCCCCCCCCCC");
  expect(youtubeVideoId("https://m.youtube.com/shorts/DDDDDDDDDDD")).toBe("DDDDDDDDDDD");
  expect(youtubeVideoId("https://www.youtube.com/@lanternbay")).toBeUndefined();
  expect(youtubeVideoId("https://www.youtube.com/playlist?list=PLxxx")).toBeUndefined();
  expect(youtubeVideoId("https://media.example.com/watch?v=AAAAAAAAAAA")).toBeUndefined();
  expect(youtubeVideoId("javascript:alert(1)//youtu.be/AAAAAAAAAAA")).toBeUndefined();
  expect(youtubeVideoId("https://www.youtube.com/watch?v=short")).toBeUndefined();
  expect(youtubeVideoId("not a url")).toBeUndefined();
});

test("manga, light novels and one-shots open on the chosen site, AniList when MyAnimeList doesn't list them (#192)", () => {
  const novel = card({ type: "MANGA", format: "NOVEL", idMal: 4242 });
  expect(entryAction(novel, "myanimelist")).toEqual({ kind: "site", badge: "Light novel", url: "https://myanimelist.net/manga/4242", site: "MyAnimeList" });
  expect(entryAction(novel, "anilist")).toEqual({ kind: "site", badge: "Light novel", url: "https://anilist.co/manga/920001", site: "AniList" });
  const oneShot = card({ type: "MANGA", format: "ONE_SHOT" });
  expect(entryAction(oneShot, "myanimelist")).toMatchObject({ badge: "One-shot", url: "https://anilist.co/manga/920001" });
  expect(entryKind(card({ type: "MANGA", format: "MANGA" }))).toBe("Manga");
  // Only whole-number ids go into a link.
  expect(entryAction(card({ type: "MANGA", idMal: "../../x" as unknown as number }), "myanimelist")).toMatchObject({ url: "https://anilist.co/manga/920001" });
});

test("a music video plays its YouTube video when AniList lists one, else opens on the site (#192)", () => {
  expect(entryAction(card({ format: "MUSIC", externalLinks: yt("https://youtu.be/AAAAAAAAAAA") }), "myanimelist")).toEqual({
    kind: "youtube",
    ytId: "AAAAAAAAAAA",
    badge: "Music video",
  });
  expect(entryAction(card({ format: "MUSIC", idMal: 77 }), "myanimelist")).toEqual({
    kind: "site",
    badge: "Music video",
    url: "https://myanimelist.net/anime/77",
    site: "MyAnimeList",
  });
});

test("another anime leaves its page only when ani.zip knows nothing, no link plays it and it has a YouTube video (#192)", () => {
  const short = card({ format: "ONA", externalLinks: yt("https://www.youtube.com/watch?v=EEEEEEEEEEE") });
  expect(entryAction(short, "myanimelist", { unknown: true, linked: false })).toEqual({ kind: "youtube", ytId: "EEEEEEEEEEE", badge: "ONA" });
  // Not answered yet, known to ani.zip, or linked by the user: its page.
  expect(entryAction(short, "myanimelist")).toEqual({ kind: "page" });
  expect(entryAction(short, "myanimelist", { unknown: false, linked: false })).toEqual({ kind: "page" });
  expect(entryAction(short, "myanimelist", { unknown: true, linked: true })).toEqual({ kind: "page" });
  // ani.zip not knowing it without a YouTube video: its page still (a split part or a title match may play it).
  expect(entryAction(card({ format: "ONA" }), "myanimelist", { unknown: true, linked: false })).toEqual({ kind: "page" });
  // A channel link isn't a video.
  expect(entryAction(card({ format: "ONA", externalLinks: yt("https://www.youtube.com/@lanternbay") }), "anilist", { unknown: true, linked: false })).toEqual({
    kind: "page",
  });
});
