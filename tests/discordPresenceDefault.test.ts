import { expect, test } from "bun:test";

/** prefs.ts reads localStorage once, as it loads: each case loads a fresh copy over its own storage. */
async function loadWith(entries: Record<string, string>, tag: string) {
  const mem = new Map(Object.entries(entries));
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  };
  const m = (await import(`../src/lib/settings/prefs?discord-${tag}`)) as typeof import("../src/lib/settings/prefs");
  return m.getPrefs().discordPresence;
}

test("Show on Discord starts at \"That you're watching\" (#150)", async () => {
  expect(await loadWith({}, "new")).toBe("app");
  // Prefs stored before the setting existed never held a choice: they take the default too.
  expect(await loadWith({ "polar.prefs": JSON.stringify({ uiSounds: false }) }, "before")).toBe("app");
});

test("a stored Show on Discord stays as it was after the update (#150)", async () => {
  expect(await loadWith({ "polar.prefs": JSON.stringify({ discordPresence: "off" }) }, "off")).toBe("off");
  expect(await loadWith({ "polar.prefs": JSON.stringify({ discordPresence: "title" }) }, "title")).toBe("title");
});
