import { expect, test } from "bun:test";
import { needsPick, type PlayRequest } from "../src/lib/titlePlayback";
import type { RankedStream } from "../src/lib/types";

const req: PlayRequest = { type: "series", metaId: "tt0000104", videoId: "tt0000104:1:1" };
const chosen = { label: "1080p" } as RankedStream;

test("auto-pick on: Play starts the player", () => {
  expect(needsPick(true, req)).toBe(false);
});

test("auto-pick off: Play asks for a source first", () => {
  expect(needsPick(false, req)).toBe(true);
});

test("auto-pick off: a chosen source or something to resume plays", () => {
  expect(needsPick(false, req, chosen)).toBe(false);
  expect(needsPick(false, { ...req, resumable: true })).toBe(false);
});
