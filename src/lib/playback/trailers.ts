import { useQuery } from "@tanstack/react-query";
import { call } from "../platform/bridge";
import type { Meta } from "../types";
import { keys } from "../net/queryKeys";

/** A trailer as a file the app plays itself (IMDb's CDN, up to 1080p). */
export interface FileTrailer {
  name: string;
  url: string;
  quality: string;
}

/**
 * A title's trailer from IMDb, by IMDb id. Its links expire after a day, so
 * they're kept for a few hours at most. `data` null: IMDb has none (the
 * trailer player falls back to YouTube; the backdrop keeps the art).
 */
export function useFileTrailer(imdbId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: keys.trailer(imdbId),
    queryFn: () => call<FileTrailer | null>("trailer", { imdbId }).catch(() => null),
    enabled: enabled && !!imdbId?.startsWith("tt"),
    staleTime: 6 * 60 * 60_000,
    gcTime: 6 * 60 * 60_000,
    retry: false,
  });
}

/** A trailer to play in the trailer player. */
export interface TrailerRequest {
  name: string;
  /** IMDb id: its trailer plays as a file, in the app's own player. */
  imdbId?: string;
  /** A YouTube trailer: TMDB's, an addon's, or AniList's for anime. */
  ytId?: string;
  /** `ytId` is TMDB's (a TMDB key is set): play it before IMDb's file. */
  ytFirst?: boolean;
}

/**
 * What the trailer player gets for a title: TMDB's YouTube trailer first
 * when there is a TMDB key, IMDb's file next, then any other YouTube trailer.
 */
export const trailerFor = (name: string, imdbId: string | undefined, meta?: Pick<Meta, "trailerYtId" | "trailerSource">): TrailerRequest => ({
  name,
  imdbId: imdbId?.startsWith("tt") ? imdbId : undefined,
  ytId: meta?.trailerYtId,
  ytFirst: meta?.trailerSource === "tmdb" && !!meta.trailerYtId,
});
