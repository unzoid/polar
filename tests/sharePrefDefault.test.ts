import { expect, test } from "bun:test";

/** prefs.ts reads localStorage once, as it loads: each case loads a fresh copy over its own storage. */
async function loadWith(entries: Record<string, string>, tag: string) {
  const mem = new Map(Object.entries(entries));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
  const m = (await import(`../src/lib/settings/prefs?${tag}`)) as typeof import("../src/lib/settings/prefs");
  return m.getPrefs().shareAddonsAndKeys;
}

test("add-ons and keys are shared between profiles on installs from before #80, not on new ones", async () => {
  expect(await loadWith({}, "new")).toBe(false);
  expect(await loadWith({ "polar.settingsOwner": "local" }, "owner")).toBe(true);
  expect(await loadWith({ "polar.prefs": JSON.stringify({ uiSounds: false }) }, "prefs")).toBe(true);
  // Once chosen, the choice stands.
  expect(await loadWith({ "polar.prefs": JSON.stringify({ shareAddonsAndKeys: false }), "polar.settingsOwner": "p1" }, "chosen")).toBe(false);
});
