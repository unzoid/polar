import { QueryClient, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";
import { sync } from "./account/sync";
import type { ContentType, MetaPreview, Progress, Settings } from "./types";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
      refetchOnWindowFocus: false,
      retry: 1,
    },
  },
});

export const keys = {
  catalog: (type: ContentType, id: string, genre = "") => ["catalog", type, id, genre] as const,
  meta: (type: ContentType, id: string) => ["meta", type, id] as const,
  streams: (type: ContentType, videoId: string) => ["streams", type, videoId] as const,
  progress: (metaId: string) => ["progress", metaId] as const,
  continue: ["continue"] as const,
  library: ["library"] as const,
  addons: ["addons"] as const,
  settings: ["settings"] as const,
  search: (q: string) => ["search", q] as const,
  recommend: (type: ContentType, id: string) => ["recommend", type, id] as const,
};

/** `enabled` lets off-screen shelves wait until they're about to be seen. */
export const useCatalog = (type: ContentType, id: string, genre?: string, enabled = true) =>
  useQuery({ queryKey: keys.catalog(type, id, genre), queryFn: () => api.catalog(type, id, 0, genre), enabled });

export const useRecommend = (type: ContentType, id: string, enabled = true) =>
  useQuery({ queryKey: keys.recommend(type, id), queryFn: () => api.recommend(type, id), enabled, staleTime: 60 * 60_000 });

export const useMeta = (type: ContentType, id: string) =>
  useQuery({ queryKey: keys.meta(type, id), queryFn: () => api.meta(type, id), staleTime: 60 * 60_000 });

export const useStreams = (type: ContentType, videoId: string | undefined) =>
  useQuery({
    queryKey: keys.streams(type, videoId ?? ""),
    queryFn: () => api.streams(type, videoId!),
    enabled: !!videoId,
    staleTime: 10 * 60_000,
  });

export const useProgress = (metaId: string) =>
  useQuery({ queryKey: keys.progress(metaId), queryFn: () => api.progressFor(metaId), staleTime: 0 });

export const useContinueWatching = () =>
  useQuery({ queryKey: keys.continue, queryFn: api.continueWatching, staleTime: 0 });

export const useLibrary = () => useQuery({ queryKey: keys.library, queryFn: api.library, staleTime: 0 });

export const useAddons = () => useQuery({ queryKey: keys.addons, queryFn: api.addons, staleTime: Infinity });

export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: api.settings, staleTime: Infinity });

export const useSearch = (query: string) =>
  useQuery({
    queryKey: keys.search(query),
    queryFn: () => api.search(query),
    enabled: query.trim().length > 1,
    placeholderData: (prev) => prev, // keep old results on screen while typing
  });

export function useToggleLibrary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (item: MetaPreview) => api.toggleLibrary(item),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.library });
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
 * Change settings and save them right away (optimistic: the UI reflects the
 * change at once, and rolls back if saving fails). For toggles and pickers;
 * text fields that need an explicit Save use the form in Settings instead.
 */
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (patch: Partial<Settings>) => {
      const current = qc.getQueryData<Settings>(keys.settings) ?? (await api.settings());
      return api.saveSettings({ ...current, ...patch });
    },
    onMutate: async (patch) => {
      await qc.cancelQueries({ queryKey: keys.settings });
      const previous = qc.getQueryData<Settings>(keys.settings);
      if (previous) qc.setQueryData(keys.settings, { ...previous, ...patch });
      return { previous };
    },
    onError: (_e, _p, ctx) => ctx?.previous && qc.setQueryData(keys.settings, ctx.previous),
    onSuccess: (saved) => qc.setQueryData(keys.settings, saved),
  });
}
