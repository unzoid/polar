import { expect, test } from "bun:test";
import { castableUrl } from "../src/components/player/airplay";

test("#19: a receiver gets plain web links it can fetch itself", () => {
  expect(castableUrl("https://media.example.com/film.mp4")).toBe(true);
  expect(castableUrl("http://media.example.com/live/index.m3u8", {})).toBe(true);
  // On the local network is fine: the receiver is on it too.
  expect(castableUrl("http://192.0.2.10:8080/film.mp4")).toBe(true);
});

test("#19: links only this computer can open never go to a receiver", () => {
  // The add-on's request headers can't go with the link.
  expect(castableUrl("https://media.example.com/film.mp4", { Referer: "https://example.org/" })).toBe(false);
  // Served by the app itself, or a file on this computer.
  for (const url of ["http://127.0.0.1:41234/stream/0", "http://localhost:8080/a.mp4", "http://[::1]:9000/a.mp4", "http://0.0.0.0/a.mp4"])
    expect(castableUrl(url)).toBe(false);
  expect(castableUrl("file:///media/film.mp4")).toBe(false);
  expect(castableUrl("asset://localhost/film.mp4")).toBe(false);
  expect(castableUrl("not a link")).toBe(false);
});
