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
import { getPrefs } from "../settings/prefs";

function pick(): AccountBackend | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;
  if (url && key) return createSupabaseBackend(url, key, { everyEpisode: () => getPrefs().syncEpisodeHistory });
  return null;
}

export const backend = pick();

export * from "./backend";
export * from "./avatars";
export * from "./AccountProvider";
export * from "./sync";
export * from "./settingsSync";
export * from "./spacePush";
