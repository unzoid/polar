import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { sync } from "../account/sync";
import { api, isTauri } from "../api";
import { aliasTable, type AnimeLink } from "../identity";
import { keys } from "../queryKeys";

/**
 * The anime links of the active space (docs/anime-identity.md): which id
 * each AniList entry the user has opened is played from. The anime pages
 * record one once they know that id; the backend then moves library items
 * and progress kept under the entry's other ids onto it. A link the backend
 * already has costs nothing (it answers "unchanged" without saving).
 */

/** Record a link; when it changed anything, what shows library and progress reloads and sync sends it. */
export async function linkAnime(qc: QueryClient, link: Omit<AnimeLink, "updatedAt">) {
  if (!isTauri) return;
  const changed = await api.linkAnime(link).catch(() => false);
  // A stored link can change without moving anything; it's a local read, so just ask again.
  void qc.invalidateQueries({ queryKey: keys.animeLinks });
  if (!changed) return;
  for (const k of [keys.library, keys.progressAll, keys.continue, keys.history]) void qc.invalidateQueries({ queryKey: k });
  sync.schedule();
}

/** The stored links. */
export const animeLinks = (): Promise<AnimeLink[]> => (isTauri ? api.animeLinks().catch(() => []) : Promise.resolve([]));

/** The stored links as an alias table ({@link aliasTable}), for merging the same show under its ids. */
export function useAnimeAliases(): ReadonlyMap<string, string> {
  const { data } = useQuery({ queryKey: keys.animeLinks, queryFn: animeLinks, staleTime: Infinity });
  return useMemo(() => aliasTable(data ?? []), [data]);
}
