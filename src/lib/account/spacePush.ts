/**
 * Pushing one profile's local library, progress and anime links without pulling (critique C2):
 * used by sync.ts for the active profile's round, for profiles left with unpushed changes, and
 * before sign-out, which drops every profile's copy from this device. Kept apart from sync.ts so
 * it can be tested without the app's `window`.
 */
import type { LocalChanges, Pushed } from "../types";
import type { SyncChanges } from "./backend";

export interface PushDeps {
  /** Local changes not yet on the server (`api.syncChanges`). */
  changes(space: string): Promise<LocalChanges>;
  /** To the server; resolves to whether the links were stored. */
  push(space: string, changes: SyncChanges): Promise<{ links: boolean }>;
  /** These reached the server (`api.syncMarkPushed`). */
  markPushed(space: string, pushed: Pushed): Promise<void>;
}

/**
 * One space's changes up to the server. What was sent is marked pushed by the time it carried, so
 * an edit made meanwhile goes next time; rows the server kept a newer copy of come back on the
 * pull. Links a server without their table couldn't take stay unpushed and go again.
 */
export async function pushSpace(space: string, deps: PushDeps): Promise<LocalChanges> {
  const local = await deps.changes(space);
  const { library, progress } = local;
  let links = local.links;
  if (!library.length && !progress.length && !links.length) return local;
  const stored = await deps.push(space, { library, progress, links });
  if (!stored.links) links = [];
  await deps.markPushed(space, {
    library: library.map((i) => [i.id, i.updatedAt]),
    progress: progress.map((p) => [p.videoId, p.updatedAt]),
    links: links.map((l) => [l.anilist, l.updatedAt]),
  });
  return local;
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
