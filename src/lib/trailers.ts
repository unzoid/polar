import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";

/** A trailer as a file the app plays itself (IMDb's CDN, up to 1080p). */
export interface FileTrailer {
  name: string;
  url: string;
  quality: string;
}

/**
 * A title's trailer from IMDb, by IMDb id. Its links expire after a day, so
 * they're kept for a few hours at most. `data` null: IMDb has none (fall
 * back to YouTube).
 */
export function useFileTrailer(imdbId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["trailer", imdbId],
    queryFn: () => invoke<FileTrailer | null>("trailer", { imdbId }).catch(() => null),
    enabled: enabled && !!imdbId?.startsWith("tt"),
    staleTime: 6 * 60 * 60_000,
    gcTime: 6 * 60 * 60_000,
    retry: false,
  });
}
