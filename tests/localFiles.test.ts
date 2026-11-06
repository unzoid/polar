import { expect, test } from "bun:test";
import { describeDrag, fileId, fileKind, filesMeta, fileTitle, isFileId } from "../src/lib/localFiles";
import { parseMedia } from "../src/lib/party/messages";
import { pushed, type Entry } from "../src/lib/router";

// Video files on this device (#204).

const file = (name: string, size = 1) => ({ path: `/media/Open Show/${name}`, name, size });

test("a file's id is a hash of its path, never the path", () => {
  const id = fileId("/media/Open Show/Episode 1.mkv");
  expect(id).toMatch(/^file:[0-9a-f]{16}$/);
  expect(id).toBe(fileId("/media/Open Show/Episode 1.mkv"));
  expect(id).not.toBe(fileId("/media/Open Show/Episode 2.mkv"));
  expect(isFileId(id)).toBe(true);
  expect(isFileId("tt0000000")).toBe(false);
});

test("one file is a movie, several are a series of the files in the order given", () => {
  const movie = filesMeta([file("Open Film.mkv")]);
  expect(movie.type).toBe("movie");
  expect(movie.name).toBe("Open Film");
  expect(isFileId(movie.id)).toBe(true);

  const show = filesMeta([file("Episode 1.mkv"), file("Episode 2.mp4")]);
  expect(show.type).toBe("series");
  expect(show.name).toBe("Open Show");
  expect(show.videos.map((v) => [v.title, v.season, v.episode])).toEqual([
    ["Episode 1", 1, 1],
    ["Episode 2", 1, 2],
  ]);
  expect(show.videos[0].id).toBe(fileId("/media/Open Show/Episode 1.mkv"));
  expect(JSON.stringify(show)).not.toContain("/media/");
});

test("names and kinds are read from the file name", () => {
  expect(fileTitle("Open Film.2024.mkv")).toBe("Open Film.2024");
  expect(fileTitle(".hidden")).toBe(".hidden");
  expect(fileKind("film.mkv")).toBe("MKV");
  expect(fileKind("film")).toBe("");
});

test("the drop hint counts videos and folders", () => {
  expect(describeDrag(["C:\\Videos\\a.MKV", "/v/b.mp4", "/v/notes.txt", "/v/Season 1"])).toEqual({ over: true, videos: 2, folders: 1, others: 1 });
});

test("a watch party never follows a file on someone's device", () => {
  const id = fileId("/media/Open Show/Episode 1.mkv");
  expect(parseMedia({ type: "movie", metaId: id, videoId: id })).toBeUndefined();
  expect(parseMedia({ type: "series", metaId: "tt0000000", videoId: id })).toBeUndefined();
});

test("a file plays without a title page under it", () => {
  const stack: Entry[] = [{ key: 0, route: { name: "home" } }];
  const id = fileId("/media/Open Film.mkv");
  const next = pushed(stack, { name: "player", type: "movie", metaId: id, videoId: id }, () => 1);
  expect(next.map((e) => e.route.name)).toEqual(["home", "player"]);
});
