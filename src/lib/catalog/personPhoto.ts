import { useQuery } from "@tanstack/react-query";
import { keys } from "../net/queryKeys";
import { isRecord, listOf, str } from "../parse";

/**
 * A face for a cast member the metadata source gave no photo for (no TMDB key,
 * or an actor it doesn't know): IMDb's own name search, which is keyless and
 * open to the webview. Takes the best-ranked exact match that has a picture.
 */
async function fetchPersonPhoto(name: string): Promise<string | null> {
  const res = await fetch(`https://v3.sg.media-imdb.com/suggestion/x/${encodeURIComponent(name)}.json`);
  if (!res.ok) throw new Error(`IMDb answered ${res.status}`);
  const json: unknown = await res.json();
  const hits = listOf(isRecord(json) ? json.d : undefined, (x) =>
    isRecord(x) && isRecord(x.i) ? { id: str(x.id) ?? "", label: str(x.l) ?? "", image: str(x.i.imageUrl) } : undefined,
  );
  const hit = hits.find((x) => x.id.startsWith("nm") && x.image && x.label.toLowerCase() === name.toLowerCase());
  // The full-size crop is megapixels; ask Amazon's image service for one that fits a face.
  return hit?.image ? hit.image.replace(/\._V1_.*(\.\w+)$/, "._V1_UX184_$1") : null;
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
