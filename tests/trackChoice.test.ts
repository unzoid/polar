import { describe, expect, test } from "bun:test";
import type { MpvTrack } from "../src/components/player/mpvMedia";

// The language helpers come through lib/playback, which reads stored preferences: none stored. A store that
// keeps what's written, as files that run after this one in the same process expect.
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const { mpvSelection } = await import("../src/components/player/trackChoice");

// An invented file: one video, two audio tracks, two embedded subtitles.
const file = (sel: { audio?: number; sub?: number; secondary?: number } = {}): MpvTrack[] => [
  { id: 1, type: "video", codec: "hevc", selected: true },
  { id: 1, type: "audio", lang: "jpn", selected: sel.audio === 1 },
  { id: 2, type: "audio", lang: "eng", selected: sel.audio === 2 },
  {
    id: 1,
    type: "sub",
    lang: "eng",
    title: "Full",
    selected: sel.sub === 1 || sel.secondary === 1,
    "main-selection": sel.secondary === 1 ? 1 : sel.sub === 1 ? 0 : undefined,
  },
  {
    id: 2,
    type: "sub",
    lang: "eng",
    title: "Signs",
    selected: sel.sub === 2 || sel.secondary === 2,
    "main-selection": sel.secondary === 2 ? 1 : sel.sub === 2 ? 0 : undefined,
  },
];
const ADDON = [{ lang: "fr", url: "https://subs.example.com/episode.fr.srt" }];

describe("mpvSelection", () => {
  test("mpv's own choice at start: aid/sid read back as auto, track-list says what plays", () => {
    expect(mpvSelection(file({ audio: 1, sub: 1 }), "auto", "auto", ADDON)).toEqual({ audioId: "1", subId: "emb:1" });
  });

  test("an explicit choice is shown even before the track list catches up", () => {
    expect(mpvSelection(file({ audio: 1, sub: 1 }), 2, 2, ADDON)).toEqual({ audioId: "1", subId: "emb:1" });
    const noFlags = file().map(({ selected: _, ...t }) => t);
    expect(mpvSelection(noFlags, 2, 2, ADDON)).toEqual({ audioId: "2", subId: "emb:2" });
  });

  test("Off only when no subtitle is shown", () => {
    expect(mpvSelection(file({ audio: 2 }), "auto", "auto", ADDON).subId).toBe("off");
    expect(mpvSelection(file({ audio: 2 }), "auto", "no", ADDON).subId).toBe("off");
    expect(mpvSelection(file({ audio: 2, sub: 2 }), "auto", "no", ADDON).subId).toBe("emb:2");
  });

  test("a secondary subtitle isn't taken for the main one", () => {
    expect(mpvSelection(file({ audio: 1, secondary: 1 }), "auto", "auto", ADDON).subId).toBe("off");
    expect(mpvSelection(file({ audio: 1, sub: 2, secondary: 1 }), "auto", "auto", ADDON).subId).toBe("emb:2");
  });

  test("an add-on subtitle mpv loaded is shown as that language's entry", () => {
    const tracks: MpvTrack[] = [...file({ audio: 1 }), { id: 3, type: "sub", lang: "fra", external: true, "external-filename": ADDON[0].url, selected: true }];
    expect(mpvSelection(tracks, "auto", "auto", ADDON).subId).toBe("ext:fr");
  });

  test("an add-on subtitle from another source of the episode still matches by language", () => {
    const tracks: MpvTrack[] = [
      ...file({ audio: 1 }),
      { id: 3, type: "sub", lang: "fra", external: true, "external-filename": "https://other.example.org/x.srt", selected: true },
    ];
    expect(mpvSelection(tracks, "auto", "auto", ADDON).subId).toBe("ext:fr");
    expect(mpvSelection(tracks, "auto", "auto", []).subId).toBeUndefined();
  });

  test("a file without audio has no audio choice", () => {
    expect(mpvSelection([{ id: 1, type: "video", selected: true }], "auto", "auto", []).audioId).toBeUndefined();
  });
});
