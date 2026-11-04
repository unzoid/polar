import { useQuery } from "@tanstack/react-query";
import { keys } from "./queryKeys";

/**
 * A face for a cast member the metadata source gave no photo for (no TMDB key,
 * or an actor it doesn't know): IMDb's own name search, which is keyless and
 * open to the webview. Takes the best-ranked exact match that has a picture.
 */
async function fetchPersonPhoto(name: string): Promise<string | null> {
  const res = await fetch(`https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(name)}.json`);
  if (!res.ok) throw new Error(`IMDb answered ${res.status}`);
  const json = (await res.json()) as { d?: { id: string; l: string; i?: { imageUrl: string } }[] };
  const hit = json.d?.find((x) => x.id.startsWith("nm") && x.i?.imageUrl && x.l.toLowerCase() === name.toLowerCase());
  // The full-size crop is megapixels; ask Amazon's image service for one that fits a face.
  return hit?.i ? hit.i.imageUrl.replace(/\._V1_.*(\.\w+)$/, "._V1_UX184_$1") : null;
}

export function usePersonPhoto(name: string, enabled: boolean) {
  return useQuery({
    queryKey: keys.personPhoto(name),
    queryFn: () => fetchPersonPhoto(name),
    enabled,
    staleTime: 7 * 24 * 60 * 60_000,
    gcTime: 7 * 24 * 60 * 60_000,
    retry: 1,
  });
}
