import { expect, test } from "bun:test";
import { checkLink, isLinkId, isStreamLink, LINK_MAX, linkId, linkLabel, linkMedia } from "../src/lib/party/links";
import { parseMessage, parseMedia } from "../src/lib/party/messages";
import { pushed, type Entry, type Route } from "../src/lib/router";

// Watching a pasted link together (#136).

const FILM = "https://media.example.com/films/Open%20Film.mp4";

test("only web links without a sign-in in them can be shared", () => {
  expect(checkLink(`  ${FILM} `)).toEqual({ ok: true, url: FILM });
  expect(checkLink("http://media.example.com/live/index.m3u8")).toEqual({ ok: true, url: "http://media.example.com/live/index.m3u8" });
  for (const bad of ["", "   ", "media.example.com/film.mp4", "not a link", "file:///home/someone/film.mkv", "ftp://media.example.com/film.mkv", "javascript:alert(1)", "data:video/mp4;base64,AAAA"]) {
    expect(checkLink(bad).ok).toBe(false);
  }
  expect(checkLink("https://user:secret@media.example.com/film.mkv").ok).toBe(false);
  expect(checkLink("https://user@media.example.com/film.mkv").ok).toBe(false);
  expect(checkLink(`https://media.example.com/${"a".repeat(LINK_MAX)}`).ok).toBe(false);
});

test("a link's id is stable, its own and marked as a link", () => {
  const id = linkId(FILM);
  expect(id).toBe(linkId(FILM));
  expect(id).not.toBe(linkId("https://media.example.com/films/Other.mp4"));
  expect(isLinkId(id)).toBe(true);
  expect(isLinkId("tt0000000")).toBe(false);
  expect(id).toMatch(/^link:[0-9a-f]{16}$/);
});

test("a link is called by its host and file name", () => {
  expect(linkLabel(FILM)).toBe("media.example.com · Open Film.mp4");
  expect(linkLabel("https://media.example.com/")).toBe("media.example.com");
  expect(isStreamLink("https://media.example.com/live/index.m3u8?t=1")).toBe(true);
  expect(isStreamLink("https://media.example.com/film.mpd")).toBe(true);
  expect(isStreamLink(FILM)).toBe(false);
});

test("the room carries a link with its own ids, and nothing else passes as one", () => {
  const media = linkMedia(FILM);
  expect(media).toEqual({ type: "movie", metaId: linkId(FILM), videoId: linkId(FILM), url: FILM, label: "media.example.com · Open Film.mp4" });
  expect(parseMedia(media)).toEqual(media);
  const tl = { v: 2, by: "a", media, paused: false, held: false, position: 0, lag: 0 };
  expect(parseMessage({ t: "state", from: "a", tl })).toEqual({ t: "state", from: "a", tl });

  // Someone else's ids on a link, or a link on a title's ids: dropped.
  expect(parseMedia({ ...media, metaId: "tt0000000" })).toBeUndefined();
  expect(parseMedia({ ...media, videoId: "tt0000000", metaId: "tt0000000" })).toBeUndefined();
  expect(parseMedia({ ...media, url: "https://media.example.com/other.mp4" })).toBeUndefined();
  // A link the app wouldn't share itself.
  const sneaky = "https://user:pw@media.example.com/film.mp4";
  expect(parseMedia({ ...media, url: sneaky, metaId: linkId(sneaky), videoId: linkId(sneaky) })).toBeUndefined();
  const local = "file:///film.mkv";
  expect(parseMedia({ ...media, url: local, metaId: linkId(local), videoId: linkId(local) })).toBeUndefined();
  expect(parseMedia({ ...media, url: 5 })).toBeUndefined();
  // A link id without its link.
  const { url: _, ...bare } = media;
  expect(parseMedia(bare)).toBeUndefined();
  // Titles are as before.
  expect(parseMedia({ type: "movie", metaId: "tt0000000", videoId: "tt0000000" })).toEqual({ type: "movie", metaId: "tt0000000", videoId: "tt0000000" });
});

test("a link's player has no title page under it", () => {
  const media = linkMedia(FILM);
  const play: Route = { name: "player", type: "movie", metaId: media.metaId, videoId: media.videoId, stream: { url: FILM } };
  const stack: Entry[] = [{ key: 0, route: { name: "home" } }];
  expect(pushed(stack, play, () => 1).map((e) => e.route.name)).toEqual(["home", "player"]);
});
