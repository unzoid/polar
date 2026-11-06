import { call, inShell } from "./bridge";
import { errorCode, errorMessage } from "../errors";

/**
 * Where the sign-in session is kept: in the system's keychain through
 * src-tauri/src/keychain.rs, which takes only the auth client's own names (`polar.auth…`) and
 * settings sync's copy of the keys (`polar.sync.…`, lib/account/localSecrets.ts).
 *
 * The web view's storage is the fallback: outside the shell, where there is no keychain (a
 * Linux desktop without a Secret Service, phone builds for now), or when it refuses. A value
 * found there was written before this version or while the keychain failed, so it is the
 * newer one: it moves into the keychain the first time the keychain takes it.
 *
 * The auth client reads its session before every request, so values are kept in memory after
 * the first read: the keychain is asked once per name per run.
 */
export interface KeyStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  /** What `key` holds as far as this run knows already: `undefined` until a `getItem` or a write. */
  peek(key: string): string | null | undefined;
}

/** What the storage needs: the native call, the fallback storage, and whether there is a shell at all. */
export interface KeychainDeps {
  call: <T>(command: string, args: Record<string, unknown>) => Promise<T>;
  local: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  shell: boolean;
}

export function createKeychainStorage({ call, local, shell }: KeychainDeps): KeyStorage {
  const known = new Map<string, string | null>();
  // Writes to one name reach the keychain in the order they were made.
  const queued = new Map<string, Promise<void>>();
  const inTurn = (key: string, write: () => Promise<void>) => {
    const next = (queued.get(key) ?? Promise.resolve()).then(write, write);
    queued.set(key, next);
    return next;
  };
  // No keychain on this system: not asked again until the next start.
  let usable = shell;

  const native = async <T>(command: string, args: Record<string, unknown>): Promise<T> => {
    try {
      return await call<T>(command, args);
    } catch (e) {
      if (errorCode(e) === "unsupported") usable = false;
      console.warn(`keychain: ${errorMessage(e)}`);
      throw e;
    }
  };

  /** Into the keychain, or into the web view's storage when the keychain won't take it. */
  const keep = async (key: string, value: string) => {
    if (usable) {
      try {
        await native("keychain_set", { name: key, value });
        local.removeItem(key);
        return;
      } catch {
        /* falls back below */
      }
    }
    local.setItem(key, value);
  };

  return {
    async getItem(key) {
      if (known.has(key)) return known.get(key) ?? null;
      const here = local.getItem(key);
      let value = here;
      if (here !== null) {
        known.set(key, here);
        if (usable) await inTurn(key, () => keep(key, here));
      } else if (usable) {
        try {
          value = await native<string | null>("keychain_get", { name: key });
        } catch {
          value = null;
        }
      }
      // A write made while the keychain was asked is the newer value.
      if (!known.has(key)) known.set(key, value);
      return known.get(key) ?? null;
    },
    setItem(key, value) {
      known.set(key, value);
      return inTurn(key, () => keep(key, value));
    },
    removeItem(key) {
      known.set(key, null);
      return inTurn(key, async () => {
        local.removeItem(key);
        if (usable) await native("keychain_delete", { name: key }).catch(() => undefined);
      });
    },
    peek: (key) => known.get(key),
  };
}

let shared: KeyStorage | undefined;

/** The app's session storage (one per run, so its memory is shared). */
export function keychainStorage(): KeyStorage {
  shared ??= createKeychainStorage({ call, local: localStorage, shell: inShell });
  return shared;
}
