import type { ContentType } from "../types";
import { SIMKL_CLIENT_ID, simklUrl } from "./api";
import { simklRefOf } from "./items";
import type { SimklItem } from "./pull";

/** Where Simkl keeps each kind's pages. */
const PATH = { movies: "movies", shows: "tv", anime: "anime" } as const;

/**
 * The title's own page on Simkl (#86), which Simkl's API rules ask apps to link each title to: by
 * Simkl's number when the profile's lists gave it, else through Simkl's `/redirect`, which finds
 * the page by the IMDb id or Kitsu number Polarity has. `undefined` for what Simkl can't be told
 * about (files on this device, episodes).
 */
export function simklPageUrl(item: { id: string; type: ContentType }, listed: SimklItem | undefined, appVersion: string, clientId = SIMKL_CLIENT_ID) {
  const ref = simklRefOf(item.id, item.type);
  if (!ref || ref.kind === "episode") return undefined;
  if (listed?.simkl && Number.isSafeInteger(listed.simkl) && listed.simkl > 0) return `https://simkl.com/${PATH[listed.kind]}/${listed.simkl}`;
  const query: Record<string, string> =
    "kitsu" in ref.ids ? { kitsu: String(ref.ids.kitsu), type: "anime" } : { imdb: ref.ids.imdb, type: ref.kind === "movie" ? "movie" : "show" };
  return simklUrl("/redirect", clientId, appVersion, { to: "simkl", ...query });
}
