import { isRecord, str } from "../parse";
import type { LibraryItem, Progress } from "../types";
import { simkl, type SimklCaller } from "./api";
import { SIMKL_KINDS, type SimklKind } from "./items";
import { entriesOf, watchedSince } from "./pull";

/**
 * Importing a linked Simkl account (#86) into the profile's library: optional, run from Settings →
 * Services → Simkl when the user asks. Titles on Simkl's Plan to Watch become library items, and
 * every film finished and episode watched there becomes a watched mark at the time Simkl has for
 * it. Films and shows go by their IMDb id, anime by their Kitsu number where Simkl has one, as
 * Polarity plays them (an anime's episodes only then: see pull.ts); titles with neither are
 * counted and left out. The library import (api.importLibrary) only adds: what is already there,
 * or newer, stays as it is, and nothing is removed.
 *
 * It reads each kind's list whole, three reads of the account's daily allowance; the pull
 * (pull.ts) follows changes after linking.
 */

export interface SimklImportPreview {
  library: LibraryItem[];
  progress: Progress[];
  /** Plan to Watch titles; finished films; watched episodes. */
  listed: number;
  watchedFilms: number;
  watchedEpisodes: number;
  /** Titles on the lists without an IMDb id or a Kitsu number: Polarity has nothing to play them from. */
  unlinked: number;
}

export interface SimklImportChoice {
  library: boolean;
  watched: boolean;
}

export interface SimklImportDeps {
  get: (path: string, query: Record<string, string>, caller: SimklCaller) => Promise<unknown>;
}

export const realSimklImportDeps = (): SimklImportDeps => ({ get: (path, query, caller) => simkl("GET", path, undefined, caller, query) });

const listOf = (kind: SimklKind, answer: unknown) => {
  const list = isRecord(answer) ? answer[kind] : undefined;
  return Array.isArray(list) ? list.length : 0;
};

/** Reads the account's lists whole and says what an import would bring in. */
export async function readSimklImport(token: string, deps: SimklImportDeps = realSimklImportDeps()): Promise<SimklImportPreview> {
  const caller: SimklCaller = { token };
  const library = new Map<string, LibraryItem>();
  const progress: Progress[] = [];
  let unlinked = 0;
  for (const kind of SIMKL_KINDS) {
    const answer = await deps.get(`/sync/all-items/${kind}`, { extended: "full", episode_watched_at: "yes" }, caller);
    const entries = entriesOf(kind, answer);
    unlinked += listOf(kind, answer) - entries.length;
    for (const e of entries) {
      progress.push(...watchedSince(e, 0));
      if (e.item.status !== "plantowatch" || library.has(e.id)) continue;
      const added = Date.parse(str(e.raw.added_to_watchlist_at) ?? "");
      library.set(e.id, { id: e.id, type: e.type, name: e.name, addedAt: Number.isFinite(added) ? added : 0 });
    }
  }
  const watchedFilms = progress.filter((p) => p.type === "movie").length;
  return { library: [...library.values()], progress, listed: library.size, watchedFilms, watchedEpisodes: progress.length - watchedFilms, unlinked };
}

/** What the import hands to api.importLibrary for the user's choice. */
export function planSimklImport(p: SimklImportPreview, choice: SimklImportChoice): { library: LibraryItem[]; progress: Progress[] } {
  return { library: choice.library ? p.library : [], progress: choice.watched ? p.progress : [] };
}
