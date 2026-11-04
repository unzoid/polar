/**
 * Pushing one profile's local library, progress and anime links without pulling (critique C2):
 * used by sync.ts for the active profile's round, for profiles left with unpushed changes, and
 * before sign-out, which drops every profile's copy from this device. Kept apart from sync.ts so
 * it can be tested without the app's `window`.
 */
import type { AnimeLink } from "../library/identity";
import type { LocalChanges } from "../types";
import type { SyncChanges } from "./backend";

export interface PushDeps {
  /** Local changes since the last push (`api.syncChanges`). */
  changes(space: string): Promise<LocalChanges>;
  /** To the server; resolves to whether the links were stored. */
  push(space: string, changes: SyncChanges): Promise<{ links: boolean }>;
  /** Everything up to `cursor` reached the server (`api.syncMarkPushed`). */
  markPushed(space: string, cursor: number): Promise<void>;
}

export interface PushResult {
  local: LocalChanges;
  /** The server had no place for the links: send them all again next time. */
  linksUnsent: boolean;
}

/**
 * One space's changes up to the server. `allLinks`, when given, replaces the changed links (a
 * server that couldn't take links before gets them in full); a space whose links were unsent and
 * that can't be given them in full stays unsent.
 */
export async function pushSpace(space: string, deps: PushDeps, opts: { allLinks?: AnimeLink[]; wasUnsent?: boolean } = {}): Promise<PushResult> {
  const local = await deps.changes(space);
  const links = opts.allLinks ?? local.links;
  let unsent = !!opts.wasUnsent && !opts.allLinks;
  if (local.library.length || local.progress.length || links.length) {
    const stored = await deps.push(space, { library: local.library, progress: local.progress, links });
    if (links.length > 0 && !stored.links) unsent = true;
  }
  await deps.markPushed(space, local.cursor);
  return { local, linksUnsent: unsent };
}

/** How many library items, progress entries and anime links would be lost if these spaces were dropped now. */
export async function unpushedCount(spaces: string[], changes: PushDeps["changes"]): Promise<number> {
  const counts = await Promise.all(
    spaces.map((s) =>
      changes(s).then(
        (c) => c.library.length + c.progress.length + c.links.length,
        () => 0,
      ),
    ),
  );
  return counts.reduce((a, b) => a + b, 0);
}

/** Push each space in turn; one failing (offline, server error) doesn't stop the rest. */
export async function pushEach(spaces: string[], push: (space: string) => Promise<unknown>): Promise<void> {
  for (const s of spaces) {
    try {
      await push(s);
    } catch (e) {
      console.warn("sync: could not push profile", s, e);
    }
  }
}
