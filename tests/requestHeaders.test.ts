import { expect, test } from "bun:test";
import { requestHeaders } from "../src/lib/playback/headers";

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
