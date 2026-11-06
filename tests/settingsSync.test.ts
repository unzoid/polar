import { beforeAll, describe, expect, mock, test } from "bun:test";
import type { AccountBackend } from "../src/lib/account/backend";

/**
 * Two devices and one account, round by round: the app's store, add-ons and localStorage belong to
 * whichever device `on` switched to; the server keeps one settings document (#89).
 */
interface Device {
  storage: Map<string, string>;
  settings: Record<string, unknown>;
  addons: string[];
}
const device = (keys: Record<string, string> = {}, addons: string[] = []): Device => ({
  storage: new Map(),
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
});
const P = "profile";
const round = () => s.syncSettings(P, server, () => true);

describe("keys and add-on links on every device (#89)", () => {
  const a = device({ tmdbKey: "key-a" }, ["https://addon.example.com/manifest.json"]);
  const b = device({ omdbKey: "key-b" });

  test("with no passphrase they travel as they are, and a new device keeps its own key too", async () => {
    on(a);
    await round();
    expect(stored!.data.secrets).toEqual({ keys: { tmdbKey: "key-a" }, addons: ["https://addon.example.com/manifest.json"] });
    on(b);
    await round();
    expect(b.settings.tmdbKey).toBe("key-a");
    expect(b.settings.omdbKey).toBe("key-b");
    expect(b.addons).toEqual(["https://addon.example.com/manifest.json"]);
    expect(s.secretsState(P)).toBe("plain");
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
