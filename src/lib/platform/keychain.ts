import { call, inShell } from "./bridge";
import { errorCode, errorMessage } from "../errors";

/**
 * Where the sign-in session is kept: in the system's keychain through
 * src-tauri/src/keychain.rs, which takes only the auth client's own names (`polar.auth…`).
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
}

/** What the storage needs: the native call, the fallback storage, and whether there is a shell at all. */
export interface KeychainDeps {
  call: <T>(command: string, args: Record<string, unknown>) => Promise<T>;
  local: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  shell: boolean;
}

export function createKeychainStorage({ call, local, shell }: KeychainDeps): KeyStorage {
  const known = new Map<string, string | null>();
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
        if (usable) await keep(key, here);
      } else if (usable) {
        try {
          value = await native<string | null>("keychain_get", { name: key });
        } catch {
          value = null;
        }
      }
      known.set(key, value);
      return value;
    },
    async setItem(key, value) {
      known.set(key, value);
      await keep(key, value);
    },
    async removeItem(key) {
      known.set(key, null);
      local.removeItem(key);
      if (usable) await native("keychain_delete", { name: key }).catch(() => undefined);
    },
  };
}

let shared: KeyStorage | undefined;

/** The app's session storage (one per run, so its memory is shared). */
export function keychainStorage(): KeyStorage {
  shared ??= createKeychainStorage({ call, local: localStorage, shell: inShell });
  return shared;
}
