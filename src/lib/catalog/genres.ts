import type { ContentType } from "../types";

/**
 * Genres you can browse by, per type: the names the index's catalogs take
 * (crates/index tmdb.rs `genre_id`). TV has fewer: TMDB folds some together.
 */
export const BROWSE_GENRES: Record<ContentType, string[]> = {
  movie: ["Action", "Adventure", "Animation", "Comedy", "Crime", "Documentary", "Drama", "Family", "Fantasy", "History", "Horror", "Music", "Mystery", "Romance", "Sci-Fi", "Thriller", "War", "Western"],
  series: ["Action", "Animation", "Comedy", "Crime", "Documentary", "Drama", "Family", "Mystery", "Sci-Fi", "War", "Western"],
};

/** Every genre either type has, for Search. */
export const ALL_GENRES = [...new Set([...BROWSE_GENRES.movie, ...BROWSE_GENRES.series])].sort();

/** A handful to start a search from (the navbar's suggestions, the phone's Search page); every genre is in Movies, Series and Anime → Browse. */
export const SEARCH_GENRES = ["Action", "Comedy", "Drama", "Horror", "Sci-Fi", "Thriller", "Romance", "Documentary"];
export const SEARCH_ANIME = ["Isekai", "Shounen", "Slice of Life", "Mecha", "Iyashikei", "Psychological"];

/** The genre a search names outright ("horror", "sci fi"), if any. */
export function genreOf(query: string): string | undefined {
  const q = query.trim().toLowerCase().replace(/[\s_-]+/g, "");
  if (!q) return undefined;
  const alias: Record<string, string> = { scifi: "Sci-Fi", sciencefiction: "Sci-Fi", animated: "Animation", docs: "Documentary", documentaries: "Documentary" };
  return alias[q] ?? ALL_GENRES.find((g) => g.toLowerCase().replace(/[\s_-]+/g, "") === q.replace(/s$/, "") || g.toLowerCase().replace(/-/g, "") === q);
}
