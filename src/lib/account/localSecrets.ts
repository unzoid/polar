import { storeLocal } from "../errors";
import { isRecord, storedJson, strings } from "../parse";
import { keychainStorage, type KeyStorage } from "../platform/keychain";
import type { Secrets } from "./secrets";
import type { Lock } from "./settingsDoc";

/**
 * The private part of what settings sync keeps on this device for a profile (#195): its copy of the
 * keys and add-on links as last agreed with the account, add-on links that didn't install yet, and
 * the passphrase. Kept in the system's keychain (lib/platform/keychain.ts, `polar.sync.<profile>`)
 * where there is one, else in the web view's storage under that name, as the sign-in session is;
 * the rest of the copy stays in `polar.settingsSync.<profile>` (settingsSync.ts).
 *
 * Builds before #195 kept all of it in the web view's storage: `ready` moves it the first time a
 * profile is used. One written there later, by an older build, is the newer one and moves again.
 *
 * Reading is synchronous, from what this run already knows: `ready(profile)` first, else only the
 * web view's old copy is seen.
 */
export interface Private {
  secrets?: Secrets;
  missing: string[];
  lock: Lock;
}

const name = (space: string) => `polar.sync.${space}`;
const syncKey = (space: string) => `polar.settingsSync.${space}`;
const passphraseKey = (space: string) => `polar.secretsPassphrase.${space}`;

let storage: KeyStorage | undefined;
const store = () => (storage ??= keychainStorage());

/** Tests: where the private parts go instead of the keychain. */
export function setPrivateStorage(s: KeyStorage) {
  storage = s;
  readied.clear();
}

/** `space`'s private part. */
export function privateOf(space: string): Private {
  const raw = store().peek(name(space));
  const v = typeof raw === "string" ? parse(raw) : undefined;
  return v ?? legacy(space) ?? { missing: [], lock: {} };
}

/** Replaces `space`'s private part; it reaches the keychain in the background. */
export function setPrivate(space: string, p: Private) {
  const kept: Private = { missing: p.missing, lock: p.lock };
  if (p.secrets) kept.secrets = p.secrets;
  void store().setItem(name(space), JSON.stringify(kept));
  dropLegacy(space);
}

export function forgetPrivate(space: string) {
  void store().removeItem(name(space));
  readied.delete(space);
}

const readied = new Map<string, Promise<void>>();

/** Reads `space`'s private part from the keychain, moving the web view's old copy there first. Once per run. */
export function ready(space: string): Promise<void> {
  let done = readied.get(space);
  if (!done) {
    done = (async () => {
      await store().getItem(name(space));
      const old = legacy(space);
      if (old) setPrivate(space, old);
    })();
    readied.set(space, done);
  }
  return done;
}

function parse(raw: string): Private | undefined {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(v)) return undefined;
  const p: Private = { missing: strings(v.missing), lock: readLock(v.lock) };
  if (isRecord(v.secrets)) p.secrets = readSecrets(v.secrets);
  return p;
}

const readSecrets = (v: Record<string, unknown>): Secrets => ({
  keys: isRecord(v.keys) ? Object.fromEntries(Object.entries(v.keys).filter((e): e is [string, string] => typeof e[1] === "string")) : {},
  addons: strings(v.addons),
});

function readLock(v: unknown): Lock {
  if (!isRecord(v)) return {};
  const text = (x: unknown) => (typeof x === "string" && x ? x : undefined);
  const lock: Lock = {};
  const passphrase = text(v.passphrase);
  const previous = text(v.previous);
  if (passphrase) lock.passphrase = passphrase;
  if (previous) lock.previous = previous;
  if (v.pending === "set" || v.pending === "remove") lock.pending = v.pending;
  return lock;
}

/**
 * What a build before #195 left in the web view's storage: the copy's secrets and missing links,
 * and the passphrase (before #89 the bare passphrase). Undefined when there's nothing.
 */
function legacy(space: string): Private | undefined {
  const saved = storedJson(localStorage, syncKey(space));
  const doc = isRecord(saved) && isRecord(saved.doc) ? saved.doc : undefined;
  const secrets = doc && isRecord(doc.secrets) ? readSecrets(doc.secrets) : undefined;
  const missing = isRecord(saved) && Array.isArray(saved.missing) ? strings(saved.missing) : undefined;
  const raw = localStorage.getItem(passphraseKey(space));
  if (!secrets && !missing?.length && !raw) return undefined;
  const v = raw ? storedJson(localStorage, passphraseKey(space)) : undefined;
  const lock = !raw ? {} : isRecord(v) ? readLock(v) : { passphrase: raw };
  const p: Private = { missing: missing ?? [], lock };
  if (secrets) p.secrets = secrets;
  return p;
}

function dropLegacy(space: string) {
  localStorage.removeItem(passphraseKey(space));
  const saved = storedJson(localStorage, syncKey(space));
  if (!isRecord(saved)) return;
  const doc = isRecord(saved.doc) ? { ...saved.doc } : undefined;
  if (!(doc && "secrets" in doc) && !("missing" in saved)) return;
  if (doc) delete doc.secrets;
  const { missing: _, ...rest } = saved;
  storeLocal(syncKey(space), JSON.stringify(doc ? { ...rest, doc } : rest));
}
