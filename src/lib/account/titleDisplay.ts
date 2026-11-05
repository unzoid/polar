/**
 * Names and pictures for titles pulled from an account, which keeps none (docs/supabase-storage.md
 * §3.6): each is looked up once on this device and kept in its store. Pictures the lookup didn't
 * give are built from the id where the source has a fixed pattern. Kept free of `window` so it can
 * be tested; sync.ts runs it after each round.
 */
import type { ContentType, MetaPreview, TitleDisplay, TitleRef } from "../types";

/** Pictures whose address follows from the id alone (patterns and their sources: docs/supabase-storage.md §3.6). */
export function builtPictures(id: string): { poster?: string; background?: string } {
  if (/^tt\d{1,10}$/.test(id)) {
    return { poster: `https://images.metahub.space/poster/medium/${id}/img`, background: `https://images.metahub.space/background/large/${id}/img` };
  }
  const kitsu = /^kitsu:(\d{1,10})$/.exec(id);
  if (kitsu) return { poster: `https://media.kitsu.app/anime/poster_images/${kitsu[1]}/medium.jpg` };
  return {};
}

export interface DisplayDeps {
  untitled(space: string): Promise<TitleRef[]>;
  fill(space: string, found: TitleDisplay[]): Promise<boolean>;
  meta(type: ContentType, id: string): Promise<Pick<MetaPreview, "name" | "poster" | "background">>;
}

/** Lookups at once: few enough not to crowd out what the user is opening. */
const AT_ONCE = 4;

/**
 * Looks up every untitled title of `space`, newest first, `AT_ONCE` at a time, filling each batch in
 * as it arrives. Ids in `failed` are skipped and those whose lookup fails are added to it, so a
 * title its source no longer knows isn't asked for again every round. Stops when `isActive` turns
 * false. Resolves to whether anything was filled.
 */
export async function fillUntitled(space: string, deps: DisplayDeps, failed: Set<string>, isActive: () => boolean, onFilled?: () => void): Promise<boolean> {
  const todo = (await deps.untitled(space)).filter((t) => !failed.has(t.id));
  let any = false;
  for (let i = 0; i < todo.length && isActive(); i += AT_ONCE) {
    const batch = todo.slice(i, i + AT_ONCE);
    const metas = await Promise.all(batch.map((t) => deps.meta(t.type, t.id).catch(() => null)));
    const found: TitleDisplay[] = [];
    batch.forEach((t, j) => {
      const m = metas[j];
      if (!m?.name) return void failed.add(t.id);
      const built = builtPictures(t.id);
      found.push({ id: t.id, name: m.name, poster: m.poster ?? built.poster, background: m.background ?? built.background });
    });
    if (found.length && isActive() && (await deps.fill(space, found))) {
      any = true;
      onFilled?.();
    }
  }
  return any;
}
