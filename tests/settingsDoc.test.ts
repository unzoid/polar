import { describe, expect, test } from "bun:test";
import { changedFrom, firstDoc, fromWire, mergeDocs, sameDoc, sealing, synced, toWire, withDefaults, withUnknown, type Doc } from "../src/lib/account/settingsDoc";

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

  test("no passphrase: keys and add-on links travel as they are, for the account only (#89)", async () => {
    const doc: Doc = { settings: {}, keybinds: {}, prefs: {}, secrets: { keys: { tmdbKey: "k" }, addons: ["https://a/manifest.json"] } };
    const wire = await toWire(doc, null);
    expect(wire).toEqual({ settings: {}, keybinds: {}, prefs: {}, secrets: { keys: { tmdbKey: "k" }, addons: ["https://a/manifest.json"] } });
    expect(await fromWire(wire, null, read)).toEqual(doc);
    // Read as far as it fits: values that aren't text are left out, links sorted.
    const odd = await fromWire({ secrets: { keys: { tmdbKey: 1, omdbKey: "o" }, addons: ["b", 2, "a"] } }, null, read);
    expect(odd.secrets).toEqual({ keys: { omdbKey: "o" }, addons: ["a", "b"] });
    expect((await fromWire({ secrets: "x" }, null, read)).secrets).toBeUndefined();
  });

  test("a device changing the passphrase opens the account's keys with the one it had before", async () => {
    const doc: Doc = { settings: {}, keybinds: {}, prefs: {}, secrets: { keys: { tmdbKey: "k" }, addons: [] } };
    const wire = await toWire(doc, "old");
    expect((await fromWire(wire, ["new", "old"], read)).secrets).toEqual(doc.secrets);
    expect((await fromWire(wire, ["new"], read)).unopened).toBe(wire.sealed as string);
  });

  test("comparing documents leaves the unopened field out and ignores key order", () => {
    const a: Doc = { settings: { a: 1, b: { x: 1, y: 2 } }, keybinds: {}, prefs: {} };
    const b: Doc = { settings: { b: { y: 2, x: 1 }, a: 1 }, keybinds: {}, prefs: {}, unopened: "s1.x.y.z" };
    expect(sameDoc(a, b)).toBe(true);
    expect(sameDoc(a, { ...a, prefs: { matureContent: "hide" } })).toBe(false);
  });
});

const doc = (settings: Record<string, unknown>, more: Partial<Doc> = {}): Doc => ({ settings, keybinds: {}, prefs: {}, ...more });
const secrets = (addons: string[], keys: Record<string, string> = {}) => ({ keys, addons });

describe("merging two devices' edits (critique H3)", () => {
  test("each side keeps the keys it changed; a key set back to its default is a change", () => {
    const base = doc({ seekStep: 30, autoplayNext: false });
    const here = doc({ seekStep: 5, autoplayNext: false });
    const there = doc({ seekStep: 30, subtitleSize: 2 });
    expect(mergeDocs(base, here, there)).toEqual(doc({ seekStep: 5, subtitleSize: 2 }));
  });

  test("both changed one key: this device's edit wins it, the rest still merges", () => {
    const base = doc({}, { prefs: { animeTitles: "romaji" } });
    const here = doc({}, { prefs: { animeTitles: "english" } });
    const there = doc({ seekStep: 5 }, { prefs: { animeTitles: "native" }, keybinds: { play: ["K"] } });
    expect(mergeDocs(base, here, there)).toEqual(doc({ seekStep: 5 }, { prefs: { animeTitles: "english" }, keybinds: { play: ["K"] } }));
  });

  test("add-on links merge as a set: one added here, one removed there, none lost", () => {
    const base = doc({}, { secrets: secrets(["a", "b"], { tmdbKey: "1" }) });
    const here = doc({}, { secrets: secrets(["a", "b", "c"], { tmdbKey: "1" }) });
    const there = doc({}, { secrets: secrets(["a"], { tmdbKey: "2" }) });
    expect(mergeDocs(base, here, there).secrets).toEqual(secrets(["a", "c"], { tmdbKey: "2" }));
  });

  test("first round on a device: the account's settings win, no add-on is taken away", () => {
    const here = doc({ seekStep: 5 }, { secrets: secrets(["mine"]) });
    const there = doc({ seekStep: 30 }, { secrets: secrets(["theirs"]) });
    expect(firstDoc(here, there)).toEqual(doc({ seekStep: 30 }, { secrets: secrets(["mine", "theirs"]) }));
  });

  test("first round on a device: the account's keys win, a key the account lacks stays (#89)", () => {
    const here = doc({}, { secrets: secrets([], { tmdbKey: "mine", omdbKey: "mine" }) });
    const there = doc({}, { secrets: secrets([], { tmdbKey: "theirs" }) });
    expect(firstDoc(here, there).secrets).toEqual(secrets([], { tmdbKey: "theirs", omdbKey: "mine" }));
  });

  test("keys sealed under another passphrase stay sealed as they came, and go back that way", async () => {
    const here = doc({ seekStep: 5 }, { secrets: secrets(["mine"]) });
    const there = doc({}, { unopened: "s1.other" });
    const merged = mergeDocs(here, here, there);
    expect(merged.unopened).toBe("s1.other");
    expect((await toWire(merged, "my phrase")).sealed).toBe("s1.other");
  });

  test("keys another version added are passed on, not dropped", () => {
    const saved = doc({ seekStep: 5, futureThing: 1 }, { prefs: { futurePref: true }, keybinds: { futureAction: ["X"] } });
    const knows = { settings: (k: string) => k === "seekStep", keybinds: () => false, prefs: () => false };
    const here = withUnknown(doc({ seekStep: 10 }), saved, knows);
    expect(here).toEqual(doc({ futureThing: 1, seekStep: 10 }, { prefs: { futurePref: true }, keybinds: { futureAction: ["X"] } }));
    // So a merge with the newer version's next edit keeps its keys.
    expect(mergeDocs(saved, here, doc({ seekStep: 5, futureThing: 2 })).settings).toEqual({ seekStep: 10, futureThing: 2 });
  });
});

describe("passphrase or not (#89)", () => {
  const plain = { settings: {}, secrets: { keys: {}, addons: [] } };
  const sealed = { settings: {}, sealed: "s1.x.y.z" };
  const neither = { settings: {} };

  test("no passphrase on this device: keys go as they are", () => {
    expect(sealing({}, plain)).toEqual({ seal: null, forget: false });
    expect(sealing({}, null)).toEqual({ seal: null, forget: false });
  });

  test("a passphrase stays in force while the account's keys are sealed", () => {
    expect(sealing({ passphrase: "p" }, sealed)).toEqual({ seal: "p", forget: false });
  });

  test("nothing sealed on the account and nothing pending here: the passphrase is forgotten", () => {
    // From before #89, typed while the option was off, when it sealed nothing.
    expect(sealing({ passphrase: "p" }, neither)).toEqual({ seal: null, forget: true });
    expect(sealing({ passphrase: "p" }, null)).toEqual({ seal: null, forget: true });
  });

  test("a passphrase just set here seals the plain keys", () => {
    expect(sealing({ passphrase: "p", pending: "set" }, plain)).toEqual({ seal: "p", forget: false });
    expect(sealing({ passphrase: "p", pending: "set" }, null)).toEqual({ seal: "p", forget: false });
  });

  test("removed here: the keys go back as they are; removed on another device: this one forgets it", () => {
    expect(sealing({ passphrase: "p", pending: "remove" }, sealed)).toEqual({ seal: null, forget: false });
    expect(sealing({ passphrase: "p" }, plain)).toEqual({ seal: null, forget: true });
  });
});
