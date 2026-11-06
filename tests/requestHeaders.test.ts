import { expect, test } from "bun:test";
import { requestHeaders, videoFile } from "../src/lib/playback/headers";

test("reads proxyHeaders.request, strings only", () => {
  const stream = { behaviorHints: { proxyHeaders: { request: { Referer: "https://a.example/", "X-N": 3 }, response: { a: "b" } } } };
  expect(requestHeaders(stream)).toEqual({ Referer: "https://a.example/" });
});

test("none when the add-on sent no usable headers", () => {
  expect(requestHeaders(undefined)).toBeNull();
  expect(requestHeaders({})).toBeNull();
  expect(requestHeaders({ behaviorHints: { proxyHeaders: "x" } })).toBeNull();
  expect(requestHeaders({ behaviorHints: { proxyHeaders: { request: ["a"] } } })).toBeNull();
  expect(requestHeaders({ behaviorHints: { proxyHeaders: { request: { a: 1 } } } })).toBeNull();
});

test("the file's size and name from the stream's hints, for subtitle add-ons", () => {
  expect(videoFile({ behaviorHints: { videoSize: 4512345678, filename: " Film (2010).1080p.mkv " } })).toEqual({
    size: 4512345678,
    name: "Film (2010).1080p.mkv",
  });
  expect(videoFile(undefined)).toEqual({ size: undefined, name: undefined });
  expect(videoFile({ behaviorHints: { videoSize: "4512345678", filename: "  " } })).toEqual({ size: undefined, name: undefined });
  expect(videoFile({ behaviorHints: { videoSize: -1 } }).size).toBeUndefined();
  expect(videoFile({ behaviorHints: { videoSize: 1.5 } }).size).toBeUndefined();
});
