import { type QueryClient, useQueries, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { libraryToggled } from "../library/libraryEvents";
import { useCallback } from "react";
import { api } from "../api";
import { errorCode } from "../errors";
import { sync } from "../account/sync";
import { aniZipLookup } from "../anime/anizip";
import { isKitsuId } from "../anime/kitsu";
import { usePrefs } from "../settings/prefs";
import { keys } from "./queryKeys";
import { searchMinLength } from "../catalog/searchQuery";
import { queryClient } from "./queryClient";
import type { ContentType, MetaPreview, Progress, Settings, StreamsResult } from "../types";

export { keys };
export { queryClient };

/** `enabled` lets off-screen shelves wait until they're about to be seen. */
export const useCatalog = (type: ContentType, id: string, genre?: string, enabled = true) =>
  useQuery({ queryKey: keys.catalog(type, id, genre), queryFn: () => api.catalog(type, id, 0, genre), enabled });

export const useRecommend = (type: ContentType, id: string, enabled = true) =>
  useQuery({ queryKey: keys.recommend(type, id), queryFn: () => api.recommend(type, id), enabled, staleTime: 60 * 60_000 });

export const useMeta = (type: ContentType, id: string, enabled = true) => useQuery({ ...metaQuery(type, id), enabled });

/** The query behind {@link useMeta}, for asking several titles at once. */
export const metaQuery = (type: ContentType, id: string) => ({ queryKey: keys.meta(type, id), queryFn: () => api.meta(type, id), staleTime: 60 * 60_000 });

/** api's search and meta through the query cache: what a lookup fetched, useSearch and useMeta then reuse. */
export const cachedLookup = (qc: QueryClient) => ({
  search: (query: string) => qc.fetchQuery({ queryKey: keys.search(query), queryFn: () => api.search(query) }),
  meta: (type: ContentType, id: string) =>
    qc.fetchQuery({ queryKey: keys.meta(type, id), queryFn: () => api.meta(type, id), staleTime: 60 * 60_000 }),
});

export function useStreams(type: ContentType, videoId: string | undefined) {
  const anime = useIsAnime(videoId);
  const { animeNo4k } = usePrefs();
  const no4k = anime && animeNo4k;
  const select = useCallback(
    (d: StreamsResult): StreamsResult => {
      // Settings → Anime: 4K anime is nearly always an AI upscale. Counted as hidden, like Settings' other source filters.
      const kept = no4k ? d.streams.filter((r) => (r.quality.resolution ?? 0) < 2160) : d.streams;
      return {
        ...d,
        hidden: (d.hidden ?? 0) + d.streams.length - kept.length,
        // Sources that say nothing about their audio have the original's: fansub
        // releases never name their Japanese audio. (Settings → Anime's preferred
        // release groups count in Best Match: lib/playback/bestMatch.ts.)
        streams: kept.map((r) => (r.quality.languages?.length ? r : { ...r, quality: { ...r.quality, languages: ["ja"] } })),
      };
    },
    [no4k],
  );
  return useQuery({
    queryKey: keys.streams(type, videoId ?? ""),
    queryFn: () => api.streams(type, videoId!),
    enabled: !!videoId,
    staleTime: 10 * 60_000,
    select: anime ? select : undefined,
  });
}

/** Whether a video is anime: a Kitsu id, or an IMDb show ani.zip knows. */
export function useIsAnime(videoId: string | undefined) {
  const imdb = videoId?.startsWith("tt") ? videoId.split(":")[0] : undefined;
  const { data: anime } = useQuery({
    ...aniZipLookup({ imdb_id: imdb ?? "" }),
    select: (zip) => !!zip,
    enabled: !!imdb,
    staleTime: 24 * 60 * 60_000,
  });
  return !!videoId && (isKitsuId(videoId) || !!anime);
}

/** Scores from the ratings services, once a key is set (re-asks when one is). */
export function useRatings(type: ContentType, id: string) {
  const { data: settings } = useSettings();
  const keyed = !!(settings?.mdblistKey?.trim() || settings?.omdbKey?.trim());
  return useQuery({
    queryKey: keys.ratings(type, id, settings?.mdblistKey ?? "", settings?.omdbKey ?? ""),
    queryFn: () => api.ratings(type, id),
    enabled: keyed && id.startsWith("tt"),
    staleTime: 6 * 60 * 60_000,
  });
}

export const useProgress = (metaId: string) =>
  useQuery({ queryKey: keys.progress(metaId), queryFn: () => api.progressFor(metaId), staleTime: 0 });

/** Several titles' progress at once, flattened (the Downloads page's watched marks, #15); the same cache as useProgress. */
export const useProgressOf = (metaIds: string[]) =>
  useQueries({
    queries: metaIds.map((metaId) => ({ queryKey: keys.progress(metaId), queryFn: () => api.progressFor(metaId), staleTime: 0 })),
    combine: flatProgress,
  });

// Outside the hook, so the combined list keeps its identity until a result changes.
const flatProgress = (results: { data?: Progress[] }[]) => results.flatMap((r) => r.data ?? []);

export const useContinueWatching = () =>
  useQuery({ queryKey: keys.continue, queryFn: api.continueWatching, staleTime: 0 });

export const useWatchHistory = () =>
  useQuery({ queryKey: keys.history, queryFn: api.watchHistory, staleTime: 0 });

export const useLibrary = () => useQuery({ queryKey: keys.library, queryFn: api.library, staleTime: 0 });

export const useAddons = () => useQuery({ queryKey: keys.addons, queryFn: api.addons, staleTime: Infinity });

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: api.settings, staleTime: Infinity });

export const useSearch = (query: string) =>
  useQuery({
    queryKey: keys.search(query),
    queryFn: () => api.search(query),
    enabled: query.trim().length >= searchMinLength(query.trim()),
    placeholderData: (prev) => prev, // keep old results on screen while typing
  });

export function useToggleLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (item: MetaPreview) => api.toggleLibrary(item),
    onSuccess: (inLibrary, item) => {
      qc.invalidateQueries({ queryKey: keys.library });
      libraryToggled(item, inLibrary);
      sync.schedule();
    },
  });
}

export function useSaveProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: Progress) => api.saveProgress(p),
    onSuccess: (_, p) => {
      qc.invalidateQueries({ queryKey: keys.progress(p.metaId) });
      qc.invalidateQueries({ queryKey: keys.continue });
      qc.invalidateQueries({ queryKey: keys.history });
      sync.schedule();
    },
  });
}

// --- Prefetch on intent ---------------------------------------------------
// Hovering a poster for ~120ms (or focusing it) is a strong signal the user is
// about to open it. Fetch detail then, so the page is ready on click.

export const prefetchMeta = (type: ContentType, id: string) =>
  queryClient.prefetchQuery({
    queryKey: keys.meta(type, id),
    queryFn: () => api.meta(type, id),
    staleTime: 60 * 60_000,
  });

export const prefetchStreams = (type: ContentType, videoId: string) =>
  queryClient.prefetchQuery({
    queryKey: keys.streams(type, videoId),
    queryFn: () => api.streams(type, videoId),
    staleTime: 10 * 60_000,
  });

const preloaded = new Set<string>();
export function preloadImage(src?: string) {
  if (!src || preloaded.has(src)) return;
  preloaded.add(src);
  const img = new Image();
  img.decoding = "async";
  img.src = src;
}

/**
 * What `useUpdateSettings` runs, for a given cache. Optimistic: the UI reflects the change at once
 * and rolls back if it was refused. A change that only couldn't be written (`save_failed`) stays:
 * the native side keeps it until Polarity quits, and rolling back would flip new, old, new when the
 * settings are read again (re-test 3c).
 */
export function settingsMutation(qc: QueryClient) {
  return {
    mutationFn: async (patch: Partial<Settings>) => {
      const current = qc.getQueryData<Settings>(keys.settings) ?? (await api.settings());
      return api.saveSettings({ ...current, ...patch });
    },
    onMutate: async (patch: Partial<Settings>) => {
      await qc.cancelQueries({ queryKey: keys.settings });
      const previous = qc.getQueryData<Settings>(keys.settings);
      if (previous) qc.setQueryData(keys.settings, { ...previous, ...patch });
      return { previous };
    },
    onError: (e: unknown, _p: Partial<Settings>, ctx: { previous?: Settings } | undefined) => {
      if (errorCode(e) !== "save_failed" && ctx?.previous) qc.setQueryData(keys.settings, ctx.previous);
    },
    onSuccess: (saved: Settings) => qc.setQueryData(keys.settings, saved),
  };
}

/**
 * Change settings and save them right away (see `settingsMutation`). For toggles and pickers;
 * text fields that need an explicit Save use the form in Settings instead.
 */
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation(settingsMutation(qc));
}
