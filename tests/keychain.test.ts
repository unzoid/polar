import { afterAll, beforeAll, expect, test } from "bun:test";
import { createKeychainStorage, type KeychainDeps } from "../src/lib/platform/keychain";

/** A keychain in memory behind the three commands, and a web view storage beside it. */
function setup(opts: { shell?: boolean; keychain?: "ok" | "unsupported" | "other" } = {}) {
  const kept = new Map<string, string>();
  const local = new Map<string, string>();
  const calls: string[] = [];
  let mode = opts.keychain ?? "ok";
  const call: KeychainDeps["call"] = async <T>(command: string, args: Record<string, unknown>) => {
    calls.push(command);
    if (mode !== "ok") throw { code: mode, message: `keychain ${mode}` };
    const name = String(args.name);
    if (command === "keychain_get") return (kept.get(name) ?? null) as T;
    if (command === "keychain_set") kept.set(name, String(args.value));
    if (command === "keychain_delete") kept.delete(name);
    return undefined as T;
  };
  const storage = createKeychainStorage({
    call,
    shell: opts.shell ?? true,
    local: {
      getItem: (k) => local.get(k) ?? null,
      setItem: (k, v) => void local.set(k, v),
      removeItem: (k) => void local.delete(k),
    },
  });
  return { storage, kept, local, calls, setMode: (m: typeof mode) => (mode = m) };
}

// The adapter warns in the console on each failure; keep test output quiet.
const warn = console.warn;
beforeAll(() => void (console.warn = () => {}));
afterAll(() => void (console.warn = warn));

test("a session goes to the keychain, not the web view", async () => {
  const { storage, kept, local } = setup();
  await storage.setItem("polar.auth", "{session}");
  expect(kept.get("polar.auth")).toBe("{session}");
  expect(local.size).toBe(0);
  expect(await storage.getItem("polar.auth")).toBe("{session}");
});

test("a session from before moves into the keychain on first read", async () => {
  const { storage, kept, local } = setup();
  local.set("polar.auth", "{old}");
  expect(await storage.getItem("polar.auth")).toBe("{old}");
  expect(kept.get("polar.auth")).toBe("{old}");
  expect(local.has("polar.auth")).toBe(false);
});

test("the web view's copy wins over the keychain's: it was written while the keychain failed", async () => {
  const { storage, kept, local } = setup();
  kept.set("polar.auth", "{stale}");
  local.set("polar.auth", "{newer}");
  expect(await storage.getItem("polar.auth")).toBe("{newer}");
  expect(kept.get("polar.auth")).toBe("{newer}");
  expect(local.has("polar.auth")).toBe(false);
});

test("the keychain is read once per name per run", async () => {
  const { storage, kept, calls } = setup();
  kept.set("polar.auth", "{s}");
  await storage.getItem("polar.auth");
  await storage.getItem("polar.auth");
  expect(await storage.getItem("polar.auth-code-verifier")).toBeNull();
  expect(await storage.getItem("polar.auth-code-verifier")).toBeNull();
  expect(calls).toEqual(["keychain_get", "keychain_get"]);
});

test("no keychain: the web view keeps the session, and the keychain isn't asked again", async () => {
  const { storage, local, calls } = setup({ keychain: "unsupported" });
  await storage.setItem("polar.auth", "{s}");
  expect(local.get("polar.auth")).toBe("{s}");
  await storage.setItem("polar.auth", "{s2}");
  await storage.removeItem("polar.auth");
  expect(local.has("polar.auth")).toBe(false);
  expect(calls).toEqual(["keychain_set"]);
});

test("a keychain that refuses a write: the session is kept in the web view, then moved once it works", async () => {
  const t = setup({ keychain: "other" });
  await t.storage.setItem("polar.auth", "{s}");
  expect(t.local.get("polar.auth")).toBe("{s}");
  // Next start, the keychain works again.
  t.setMode("ok");
  const next = createKeychainStorage({
    call: async <T>(command: string, args: Record<string, unknown>) => {
      if (command === "keychain_set") t.kept.set(String(args.name), String(args.value));
      return (t.kept.get(String(args.name)) ?? null) as T;
    },
    shell: true,
    local: {
      getItem: (k) => t.local.get(k) ?? null,
      setItem: (k, v) => void t.local.set(k, v),
      removeItem: (k) => void t.local.delete(k),
    },
  });
  expect(await next.getItem("polar.auth")).toBe("{s}");
  expect(t.kept.get("polar.auth")).toBe("{s}");
  expect(t.local.has("polar.auth")).toBe(false);
});

test("signing out removes the session from both", async () => {
  const { storage, kept, local } = setup();
  await storage.setItem("polar.auth", "{s}");
  local.set("polar.auth", "{left}");
  await storage.removeItem("polar.auth");
  expect(kept.has("polar.auth")).toBe(false);
  expect(local.has("polar.auth")).toBe(false);
  expect(await storage.getItem("polar.auth")).toBeNull();
});

test("outside the shell it is the web view's storage, with no native calls", async () => {
  const { storage, local, calls } = setup({ shell: false });
  local.set("polar.auth", "{s}");
  expect(await storage.getItem("polar.auth")).toBe("{s}");
  await storage.setItem("polar.auth", "{t}");
  expect(local.get("polar.auth")).toBe("{t}");
  expect(calls).toEqual([]);
});
