import type { QueryClient } from "@tanstack/react-query";
import { api, isTauri } from "../api";
import type { AnimeLink } from "../identity";

/**
 * The anime links of the active space (docs/anime-identity.md): which id
 * each AniList entry the user has opened is played from. The anime pages
 * record one once they know that id; the backend then moves library items
 * and progress kept under the entry's other ids onto it. A link the backend
 * already has costs nothing (it answers "unchanged" without saving).
 */

/** Record a link; when it moved anything, what shows library and progress reloads. */
export async function linkAnime(qc: QueryClient, link: Omit<AnimeLink, "updatedAt">) {
  if (!isTauri) return;
  const changed = await api.linkAnime(link).catch(() => false);
  if (changed) for (const k of ["library", "progress", "continue", "history"]) void qc.invalidateQueries({ queryKey: [k] });
}

/** The stored links. */
export const animeLinks = (): Promise<AnimeLink[]> => (isTauri ? api.animeLinks().catch(() => []) : Promise.resolve([]));
