/**
 * Picks the account backend. To switch providers, implement `AccountBackend`
 * in a new file and return it here; nothing else in the app changes.
 *
 * With no provider configured, `backend` is null and Polar runs fully
 * local (no sign-in screen).
 */
import type { AccountBackend } from "./backend";
import { createSupabaseBackend } from "./supabase";

function pick(): AccountBackend | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (url && key) return createSupabaseBackend(url, key);
  return null;
}

export const backend = pick();

export * from "./backend";
export * from "./avatars";
