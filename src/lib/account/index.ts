/**
 * Picks the account backend. To switch providers, implement `AccountBackend`
 * in a new file and return it here; nothing else in the app changes.
 *
 * With no provider configured, `backend` is null and Polarity runs fully
 * local (no sign-in screen).
 *
 * This file is the folder's public surface: code outside src/lib imports
 * this folder, code inside src/lib imports the file.
 */
import type { AccountBackend } from "./backend";
import { createSupabaseBackend } from "./supabase";

function pick(): AccountBackend | null {
  // fake.html's stand-in account (lib/platform/fake/account.ts): dev server only, never in a build.
  if (import.meta.env.DEV) {
    const fake = (globalThis as { __polarFakeAccount?: AccountBackend }).__polarFakeAccount;
    if (fake) return fake;
  }
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (url && key) return createSupabaseBackend(url, key);
  return null;
}

export const backend = pick();

export * from "./backend";
export * from "./avatars";
export * from "./AccountProvider";
export * from "./sync";
export * from "./settingsSync";
export { SECRET_KEYS } from "./settingsDoc";
export * from "./spacePush";
export { linkHasKey } from "./keyedLink";
export { dismissNotice, exposedNames, noticeDue, onFirstPlainSync } from "./secretsNotice";
