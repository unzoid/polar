import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { sync } from "../account/sync";
import { api } from "../api";
import { inShell } from "../platform/bridge";
import { aliasTable, type AnimeLink } from "../library/identity";
import { keys } from "../net/queryKeys";
import { linkedImdb, useListedImdb } from "./landscapeArt";

/**
 * The anime links of the active space (docs/anime-identity.md): which id
 * each AniList entry the user has opened is played from. The anime pages
 * record one once they know that id; the backend then moves library items
 * and progress kept under the entry's other ids onto it. A link the backend
 * already has costs nothing (it answers "unchanged" without saving).
 */

/** Record a link; when it changed anything, what shows library and progress reloads and sync sends it. */
export async function linkAnime(qc: QueryClient, link: Omit<AnimeLink, "updatedAt">) {
  if (!inShell) return;
  const changed = await api.linkAnime(link).catch(() => false);
  // A stored link can change without moving anything; it's a local read, so just ask again.
  void qc.invalidateQueries({ queryKey: keys.animeLinks });
  if (!changed) return;
  for (const k of [keys.library, keys.progressAll, keys.continue, keys.history]) void qc.invalidateQueries({ queryKey: k });
  sync.schedule();
}

/**
 * The show the user picked for an entry by hand (#189), stored as its link: the entry plays from it from
 * then on, on every device the space syncs to, and what was kept under its other ids moves onto it.
 */
export async function pickAnimeImdb(qc: QueryClient, link: Omit<AnimeLink, "updatedAt">) {
  await linkAnime(qc, link);
  await qc.invalidateQueries({ queryKey: keys.anime.imdb(link.anilist) });
}

/** The stored links. */
export const animeLinks = (): Promise<AnimeLink[]> => (inShell ? api.animeLinks().catch(() => []) : Promise.resolve([]));

/** The stored links as an alias table ({@link aliasTable}), for merging the same show under its ids. */
export function useAnimeAliases(): ReadonlyMap<string, string> {
  const { data } = useQuery({ queryKey: keys.animeLinks, queryFn: animeLinks, staleTime: Infinity });
  return useMemo(() => aliasTable(data ?? []), [data]);
}

/** {@link linkedImdb} for a card: the stored links and the id lists asked together. */
export function useLinkedImdb(anilistId: number) {
  const listed = useListedImdb(anilistId);
  const { data: links } = useQuery({ queryKey: keys.animeLinks, queryFn: animeLinks, staleTime: Infinity });
  return linkedImdb(anilistId, listed, links);
}
