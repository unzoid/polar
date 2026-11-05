import { cachedLookup, keys, queryClient } from "../net";
import { getPrefs } from "../settings/prefs";
import type { ContentType, MetaPreview } from "../types";
import { cachedAniZip } from "./anizip";
import { animeLinks } from "./links";
import { anilistForImdb } from "./search";
import { titlePage, type PageLookup } from "./titlePage";

const lookup = (): PageLookup => ({
  animeEnabled: getPrefs().animeEnabled,
  links: animeLinks,
  meta: (type, id) => cachedLookup(queryClient).meta(type, id),
  anilistForImdb,
  anilistForKitsu: async (kitsu) => (await cachedAniZip({ kitsu_id: kitsu }).catch(() => null))?.mappings.anilist_id ?? null,
  storage: globalThis.localStorage,
  now: Date.now,
});

/** The query that decides which page a title opens on ({@link titlePage}); the title route waits for it. */
export const titlePageQuery = (type: ContentType, id: string, preview?: MetaPreview) => ({
  queryKey: keys.titlePage(type, id),
  queryFn: () => titlePage(type, id, preview, lookup()),
  staleTime: Infinity,
});

/** Decide ahead, when a card is about to be opened (pointer or focus resting on it). */
export const prefetchTitlePage = (type: ContentType, id: string, preview?: MetaPreview) => void queryClient.prefetchQuery(titlePageQuery(type, id, preview));

