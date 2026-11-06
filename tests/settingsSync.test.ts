import { beforeAll, describe, expect, mock, test } from "bun:test";
import type { AccountBackend } from "../src/lib/account/backend";

/**
 * Two devices and one account, round by round: the app's store, add-ons and localStorage belong to
 * whichever device `on` switched to; the server keeps one settings document (#89).
 */
interface Device {
  storage: Map<string, string>;
  keychain: Map<string, string>;
  settings: Record<string, unknown>;
  addons: string[];
}
const device = (keys: Record<string, string> = {}, addons: string[] = []): Device => ({
  storage: new Map(),
  keychain: new Map(),
  settings: { seekStep: 10, tmdbKey: null, omdbKey: null, ...keys },
  addons,
});
let dev = device();
const on = (d: Device) => (dev = d);

(globalThis as { localStorage?: unknown }).localStorage = {
  getItem: (k: string) => dev.storage.get(k) ?? null,
  setItem: (k: string, v: string) => void dev.storage.set(k, v),
  removeItem: (k: string) => void dev.storage.delete(k),
};
mock.module("../src/lib/api", () => ({
  api: {
    settings: async () => ({ ...dev.settings }),
    settingsDefaults: async () => ({ seekStep: 10, tmdbKey: null, omdbKey: null }),
    saveSettings: async (s: Record<string, unknown>) => (dev.settings = { ...s }),
    addons: async () => dev.addons.map((u) => ({ manifestUrl: u, manifest: { id: u } })),
    installAddon: async (u: string) => void dev.addons.push(u),
    removeAddon: async (id: string) => void (dev.addons = dev.addons.filter((u) => u !== id)),
    bundledAddons: async () => ["https://subtitles.example.org/manifest.json"],
  },
}));
mock.module("../src/lib/net/queries", () => ({ queryClient: { setQueryData() {}, invalidateQueries() {} } }));

let stored: { data: Record<string, unknown>; updatedAt: number } | null = null;
const server = {
  settings: {
    get: async () => stored && structuredClone(stored),
    put: async (_: string, doc: { data: Record<string, unknown>; updatedAt: number }) => {
      if (stored && doc.updatedAt <= stored.updatedAt) return null;
      stored = structuredClone(doc);
      return doc.updatedAt;
    },
  },
} as unknown as AccountBackend;

let s: typeof import("../src/lib/account/settingsSync");
beforeAll(async () => {
  s = await import("../src/lib/account/settingsSync");
  // Each device's keychain: its own map, apart from its web view storage (#195).
  const { setPrivateStorage } = await import("../src/lib/account/localSecrets");
  setPrivateStorage({
    getItem: async (k) => dev.keychain.get(k) ?? null,
    setItem: async (k, v) => void dev.keychain.set(k, v),
    removeItem: async (k) => void dev.keychain.delete(k),
    peek: (k) => dev.keychain.get(k) ?? null,
  });
});
const P = "profile";
const round = () => s.syncSettings(P, server, () => true);

describe("keys and add-on links on every device (#89)", () => {
  const a = device({ tmdbKey: "key-a" }, ["https://addon.example.com/manifest.json"]);
  const b = device({ omdbKey: "key-b" });

  test("with no passphrase they travel as they are, and a new device keeps its own key too", async () => {
    const { onFirstPlainSync } = await import("../src/lib/account/secretsNotice");
    const told: string[] = [];
    const stop = onFirstPlainSync((space) => told.push(space));
    on(a);
    await round();
    // #195: each device says once that its keys went up readable.
    expect(told).toEqual([P]);
    await round();
    expect(told).toEqual([P]);
    expect(stored!.data.secrets).toEqual({ keys: { tmdbKey: "key-a" }, addons: ["https://addon.example.com/manifest.json"] });
    on(b);
    await round();
    expect(b.settings.tmdbKey).toBe("key-a");
    expect(b.settings.omdbKey).toBe("key-b");
    expect(b.addons).toEqual(["https://addon.example.com/manifest.json"]);
    expect(s.secretsState(P)).toBe("plain");
    expect(told).toEqual([P, P]);
    stop();
  });

  test("a passphrase set on one device seals them; the other leaves the seal alone and asks", async () => {
    on(a);
    await round();
    s.setSecretsPassphrase(P, "correct horse");
    await round();
    expect(typeof stored!.data.sealed).toBe("string");
    expect(stored!.data.secrets).toBeUndefined();
    expect(JSON.stringify(stored)).not.toContain("key-a");
    expect(s.secretsState(P)).toBe("sealed");

    on(b);
    b.settings.omdbKey = "key-b2"; // a change here doesn't reach the sealed copy
    const seal = stored!.data.sealed;
    await round();
    expect(s.secretsState(P)).toBe("locked");
    expect(stored!.data.sealed).toBe(seal);
    expect(b.settings.omdbKey).toBe("key-b2");

    s.unlockSecrets(P, "wrong");
    await round();
    expect(s.secretsState(P)).toBe("locked");
    s.unlockSecrets(P, "correct horse");
    await round();
    expect(s.secretsState(P)).toBe("sealed");
    expect(b.settings.omdbKey).toBe("key-b");
  });

  test("changing it on one device: the other asks for the new one", async () => {
    on(a);
    s.setSecretsPassphrase(P, "battery staple");
    await round();
    expect(s.secretsState(P)).toBe("sealed");
    on(b);
    await round();
    expect(s.secretsState(P)).toBe("locked");
    s.unlockSecrets(P, "battery staple");
    await round();
    expect(s.secretsState(P)).toBe("sealed");
  });

  test("removing it on one device turns them back to the plain form for every device", async () => {
    on(a);
    a.settings.tmdbKey = "key-a2";
    s.removeSecretsPassphrase(P);
    expect(s.secretsState(P)).toBe("plain");
    await round();
    expect(stored!.data.sealed).toBeUndefined();
    expect((stored!.data.secrets as { keys: Record<string, string> }).keys.tmdbKey).toBe("key-a2");
    expect(a.storage.has(`polar.secretsPassphrase.${P}`)).toBe(false);
    on(b);
    await round();
    expect(s.secretsState(P)).toBe("plain");
    expect(b.settings.tmdbKey).toBe("key-a2");
    expect(b.storage.has(`polar.secretsPassphrase.${P}`)).toBe(false);
    // And b's next edit goes up as it is, not sealed with the forgotten passphrase.
    b.settings.omdbKey = "key-b3";
    await round();
    expect((stored!.data.secrets as { keys: Record<string, string> }).keys.omdbKey).toBe("key-b3");
  });

  test("a passphrase from before #89, typed with the option off, seals nothing", async () => {
    const c = device();
    on(c);
    c.storage.set(`polar.secretsPassphrase.${P}`, "old phrase");
    await round();
    expect(stored!.data.sealed).toBeUndefined();
    expect(s.secretsState(P)).toBe("plain");
  });
});

describe("this device's copy of the keys (#195)", () => {
  test("its keys, links and passphrase are in the keychain, not the web view's storage", async () => {
    stored = null;
    const d = device({ tmdbKey: "key-d" }, ["https://addon.example.com/TOKEN/manifest.json"]);
    on(d);
    s.setSecretsPassphrase(P, "staple");
    await round();
    const web = JSON.stringify([...d.storage]);
    expect(web).not.toContain("key-d");
    expect(web).not.toContain("TOKEN");
    expect(web).not.toContain("staple");
    expect(d.storage.has(`polar.settingsSync.${P}`)).toBe(true);
    const kept = d.keychain.get(`polar.sync.${P}`)!;
    expect(kept).toContain("key-d");
    expect(kept).toContain("staple");
    expect(s.secretsState(P)).toBe("sealed");
  });

  test("a copy an older build left in the web view's storage moves to the keychain", async () => {
    const e = device({ tmdbKey: "key-e" });
    on(e);
    const doc = { settings: {}, keybinds: {}, prefs: {}, secrets: { keys: { tmdbKey: "key-e" }, addons: [] } };
    e.storage.set(`polar.settingsSync.legacy`, JSON.stringify({ doc, at: 5, missing: ["https://addon.example.com/TOKEN/manifest.json"] }));
    e.storage.set(`polar.secretsPassphrase.legacy`, JSON.stringify({ passphrase: "old" }));
    await s.restoreSettings("legacy");
    const web = JSON.stringify([...e.storage]);
    expect(web).not.toContain("key-e");
    expect(web).not.toContain("TOKEN");
    expect(e.storage.has("polar.secretsPassphrase.legacy")).toBe(false);
    expect(JSON.parse(e.storage.get("polar.settingsSync.legacy")!).at).toBe(5);
    const kept = JSON.parse(e.keychain.get("polar.sync.legacy")!);
    expect(kept.secrets.keys.tmdbKey).toBe("key-e");
    expect(kept.lock.passphrase).toBe("old");
    expect(s.secretsState("legacy")).toBe("sealed");
  });
});

describe("a server without the settings table (#16)", () => {
  test("is logged once and reported for Settings → Account until settings sync again", async () => {
    const { AccountError } = await import("../src/lib/account/backend");
    const missing = {
      settings: {
        get: async () => {
          throw new AccountError("not_set_up", "Could not find the table 'public.profile_settings'");
        },
      },
    } as unknown as AccountBackend;
    const warn = mock(() => {});
    const original = console.warn;
    console.warn = warn;
    try {
      on(device());
      await s.syncSettings(P, missing, () => true);
      await s.syncSettings(P, missing, () => true);
      expect(s.settingsSyncProblem()).toBe("not_set_up");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String((warn.mock.calls[0] as unknown[])[0])).toContain("profile_settings");
      await round();
      expect(s.settingsSyncProblem()).toBeNull();
    } finally {
      console.warn = original;
    }
  });
});

describe("add-ons and keys per profile on this device (#80)", () => {
  const subtitles = "https://subtitles.example.org/manifest.json";
  const guestAddon = "https://addon.example.com/guest.json";

  test("a profile new to this device starts without the guest's, none of them reach its account, and it can copy them", async () => {
    const g = device({ tmdbKey: "guest-key" }, [subtitles, guestAddon]);
    on(g);
    stored = null;
    g.storage.set("polar.settingsOwner", "local");
    await s.keepDeviceSettings("Q");
    expect(await s.startProfile("Q")).toBe(true);
    // The app's own add-on stays; the guest's key and add-on are gone from the store.
    expect(g.settings.tmdbKey).toBeNull();
    expect(g.addons).toEqual([subtitles]);

    await s.syncSettings("Q", server, () => true);
    expect(JSON.stringify(stored)).not.toContain("guest-key");
    expect(JSON.stringify(stored)).not.toContain("guest.json");

    // Settings → Account offers the guest's set, and copying adds it to the profile's.
    expect(s.setupSources("Q", ["Q", "other"])).toEqual([{ id: "local", keys: 1, addons: 2 }]);
    await s.copySetup("local");
    expect(g.settings.tmdbKey).toBe("guest-key");
    expect(g.addons.sort()).toEqual([guestAddon, subtitles]);

    // Signing out gives the guest back exactly what it had.
    g.settings.tmdbKey = "changed-by-q";
    await s.restoreDeviceSettings();
    expect(g.settings.tmdbKey).toBe("guest-key");
    expect(g.addons.sort()).toEqual([guestAddon, subtitles]);
  });

  test("a profile this device has synced before keeps what it had", async () => {
    // "Q" synced in the test above.
    expect(await s.startProfile("Q")).toBe(false);
  });

  test("shared between profiles on this device: a new profile starts with what's here, as before #80", async () => {
    const { setPrefs } = await import("../src/lib/settings/prefs");
    const h = device({ tmdbKey: "shared-key" }, [guestAddon]);
    on(h);
    setPrefs({ shareAddonsAndKeys: true });
    try {
      expect(await s.startProfile("R")).toBe(false);
      expect(h.settings.tmdbKey).toBe("shared-key");
      expect(h.addons).toEqual([guestAddon]);
    } finally {
      setPrefs({ shareAddonsAndKeys: false });
    }
  });

  test("nothing to clear: nothing is touched", async () => {
    const e = device({}, [subtitles]);
    on(e);
    expect(await s.startProfile("S")).toBe(false);
    expect(e.addons).toEqual([subtitles]);
  });
});
