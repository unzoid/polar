/**
 * Where a title link from outside goes (#153, #208): IMDb and Kitsu ids open their page as they are;
 * TMDB's id is looked up for its IMDb id (with the user's TMDB key), AniList's opens the anime's page,
 * and MyAnimeList's is looked up on AniList first. What can't be opened comes back as words to show.
 */
import type { Route } from "../router";
import type { DeepLink } from "./deepLink";

type TitleLink = Extract<DeepLink, { kind: "title" | "tmdb" | "anime" }>;

export type TitleLookups = {
  imdbForTmdb: (type: "movie" | "series", id: number) => Promise<string | null>;
  anilistForMal: (id: number) => Promise<number | null>;
};

export async function titleRoute(link: TitleLink, lookups: TitleLookups): Promise<Route | string> {
  switch (link.kind) {
    case "title":
      return { name: "detail", type: link.type, id: link.id };
    case "tmdb": {
      let imdb: string | null;
      try {
        imdb = await lookups.imdbForTmdb(link.type, link.id);
      } catch {
        return "Polarity couldn't reach TMDB to find that title. Try again in a moment.";
      }
      return imdb ? { name: "detail", type: link.type, id: imdb } : "Polarity couldn't find that TMDB title. TMDB pages open in Polarity when a TMDB key is set (Settings → Services) and TMDB lists the title's IMDb page.";
    }
    case "anime": {
      if (link.source === "anilist") return { name: "anime-detail", id: link.id };
      let id: number | null;
      try {
        id = await lookups.anilistForMal(link.id);
      } catch {
        return "Polarity couldn't reach AniList to find that anime. Try again in a moment.";
      }
      return id ? { name: "anime-detail", id } : "AniList doesn't know that MyAnimeList anime, so Polarity can't open it.";
    }
  }
}
