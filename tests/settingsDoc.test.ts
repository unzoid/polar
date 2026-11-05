import { describe, expect, test } from "bun:test";
import { changedFrom, fromWire, sameDoc, synced, toWire, withDefaults, type Doc } from "../src/lib/account/settingsDoc";

const defaults = { autoplayNext: true, seekStep: 10, subtitleStyle: { size: 1, color: "#FFFFFF" }, tmdbKey: null, metadataSource: "cinemeta" };
const read = (v: Record<string, unknown>) => ({
  settings: (v.settings ?? {}) as Record<string, unknown>,
  keybinds: (v.keybinds ?? {}) as Record<string, string[]>,
  prefs: (v.prefs ?? {}) as Record<string, unknown>,
});

describe("settings document (I-009)", () => {
  test("only what differs from the defaults goes in, never keys or the metadata source", () => {
    const now = { autoplayNext: true, seekStep: 30, subtitleStyle: { color: "#FFFFFF", size: 1 }, tmdbKey: "secret", metadataSource: "tmdb" };
    expect(changedFrom(now, defaults, synced)).toEqual({ seekStep: 30 });
    expect(changedFrom({ ...now, subtitleStyle: { size: 2, color: "#FFFFFF" } }, defaults, synced)).toEqual({
      seekStep: 30,
      subtitleStyle: { size: 2, color: "#FFFFFF" },
    });
  });

  test("reading it back: every synced key at its default unless changed", () => {
    expect(withDefaults({ seekStep: 30, unknown: 1 }, defaults, synced)).toEqual({
      autoplayNext: true,
      seekStep: 30,
      subtitleStyle: { size: 1, color: "#FFFFFF" },
    });
  });

  test("an old document's keys and add-on links are not taken", async () => {
    const old = { settings: { seekStep: 5, tmdbKey: "k", omdbKey: "o", metadataSource: "tmdb" }, addons: ["https://a/manifest.json"], keybinds: {}, prefs: {} };
    const doc = await fromWire(old, null, read);
    expect(doc.settings).toEqual({ seekStep: 5 });
    expect("addons" in doc).toBe(false);
    expect(doc.secrets).toBeUndefined();
  });

  test("with a passphrase, keys and add-on links travel sealed and come back", async () => {
    const doc: Doc = { settings: { seekStep: 5 }, keybinds: {}, prefs: {}, secrets: { keys: { tmdbKey: "k" }, addons: ["https://a/manifest.json"] } };
    const wire = await toWire(doc, "pass phrase");
    expect(Object.keys(wire).sort()).toEqual(["keybinds", "prefs", "sealed", "settings"]);
    expect(JSON.stringify(wire).includes("a/manifest")).toBe(false);
    expect(await fromWire(wire, "pass phrase", read)).toEqual(doc);

    // Without the passphrase (or with another) the sealed field is kept as it came, to go back unchanged.
    const locked = await fromWire(wire, null, read);
    expect(locked.secrets).toBeUndefined();
    expect(locked.unopened).toBe(wire.sealed as string);
    expect((await toWire(locked, null)).sealed).toBe(wire.sealed);
    expect((await fromWire(wire, "other", read)).unopened).toBe(wire.sealed as string);
  });

  test("no passphrase: nothing sealed goes out", async () => {
    const doc: Doc = { settings: {}, keybinds: {}, prefs: {}, secrets: { keys: { tmdbKey: "k" }, addons: [] } };
    expect(await toWire(doc, null)).toEqual({ settings: {}, keybinds: {}, prefs: {} });
  });

  test("comparing documents leaves the unopened field out and ignores key order", () => {
    const a: Doc = { settings: { a: 1, b: { x: 1, y: 2 } }, keybinds: {}, prefs: {} };
    const b: Doc = { settings: { b: { y: 2, x: 1 }, a: 1 }, keybinds: {}, prefs: {}, unopened: "s1.x.y.z" };
    expect(sameDoc(a, b)).toBe(true);
    expect(sameDoc(a, { ...a, prefs: { matureContent: "hide" } })).toBe(false);
  });
});
