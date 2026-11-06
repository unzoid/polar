import { describe, expect, test } from "bun:test";
import { lookaheadCaption } from "../src/lib/playback/lookahead";

describe("the lookahead setting's caption", () => {
  const base = "Reads a little of the video ahead.";

  test("says nothing more with nothing playing", () => {
    expect(lookaheadCaption(base, null)).toBe(base);
  });

  test("says whether it reads ahead in the video playing now, and why not", () => {
    expect(lookaheadCaption(base, "reading")).toBe(`${base} Reading ahead in the video playing now.`);
    expect(lookaheadCaption(base, "live")).toBe(`${base} Not reading ahead in the video playing now: it's a live stream, with nothing ahead to read.`);
    expect(lookaheadCaption(base, "this-device")).toBe(`${base} Not available on this device yet.`);
    for (const s of ["no-reader", "not-opened", "no-seeking", "stopped"] as const) {
      expect(lookaheadCaption(base, s)).toMatch(/^Reads a little of the video ahead\. Not reading ahead in the video playing now: .+\.$/);
    }
  });
});
