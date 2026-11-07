import { storeLocal } from "../errors";
import { isRecord, num, storedJson } from "../parse";
import type { TraktCaller } from "./api";
import { readTraktItem } from "./items";
import { pendingTraktOps } from "./queue";

/**
 * The profile's Trakt ratings of films and shows (#85), kept on the device so a title page shows
 * its rating without asking Trakt: read from Trakt when its ratings moved (pull.ts), changed here
 * at once when the profile rates a title (traktSync.ts sends it), dropped when the profile unlinks.
 * Keyed by the title's IMDb id; ratings are Trakt's 1–10.
 */
export type TraktRatings = Record<string, number>;

export const traktRatingsKey = (space: string | null) => `polar.trakt.ratings.${space ?? "local"}`;

const IMDB = /^tt\d{1,10}$/;

/** A rating Trakt takes: a whole number from 1 to 10. */
export const validRating = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 10;

export function readRatings(v: unknown): TraktRatings {
  const out: TraktRatings = {};
  if (!isRecord(v)) return out;
  for (const [id, n] of Object.entries(v)) if (IMDB.test(id) && validRating(n)) out[id] = n;
  return out;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The profile's ratings; `undefined` when they were never read from Trakt. */
export function traktRatings(space: string | null, storage: Pick<Storage, "getItem"> = localStorage): TraktRatings | undefined {
  const v = storedJson(storage, traktRatingsKey(space));
  return v === undefined ? undefined : readRatings(v);
}

const listeners = new Set<() => void>();

/** Hear when the profile's ratings change; returns the function that stops listening. */
export function onTraktRatings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function write(space: string | null, ratings: TraktRatings, storage: Store) {
  storeLocal(traktRatingsKey(space), JSON.stringify(ratings), storage);
  listeners.forEach((l) => l());
}

/** One title's rating set (1–10) or taken off (`null`) on the device. */
export function keepTraktRating(space: string | null, imdb: string, rating: number | null, storage: Store = localStorage) {
  const ratings = { ...traktRatings(space, storage) };
  if (rating === null) delete ratings[imdb];
  else ratings[imdb] = rating;
  write(space, ratings, storage);
}

/** A `/sync/ratings/movies` or `/sync/ratings/shows` item as an IMDb id and its rating. */
export function ratingRow(v: unknown): [string, number] | undefined {
  if (!isRecord(v)) return undefined;
  const ref = readTraktItem(v);
  const rating = num(v.rating);
  if (!ref || ref.kind === "episode" || !validRating(rating)) return undefined;
  return [ref.imdb, rating];
}

/**
 * Reads the profile's film and show ratings from Trakt and keeps them in place of what the device
 * had; ratings made here that are still waiting to go out stay on top. Returns how many it kept.
 */
export async function pullRatings(space: string | null, caller: TraktCaller, get: (path: string, caller: TraktCaller) => Promise<unknown>, storage: Store) {
  const ratings: TraktRatings = {};
  for (const kind of ["movies", "shows"]) {
    const items = await get(`/sync/ratings/${kind}`, caller);
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const row = ratingRow(item);
      if (row) ratings[row[0]] = row[1];
    }
  }
  for (const op of pendingTraktOps(space, storage)) {
    if (op.list !== "ratings" || op.ref.kind === "episode") continue;
    if (op.remove) delete ratings[op.ref.imdb];
    else if (validRating(op.extra?.rating)) ratings[op.ref.imdb] = op.extra.rating;
  }
  write(space, ratings, storage);
  return Object.keys(ratings).length;
}

/** Forgets the profile's ratings (unlinking). */
export function forgetTraktRatings(space: string | null, storage: Pick<Storage, "removeItem"> = localStorage) {
  storage.removeItem(traktRatingsKey(space));
  listeners.forEach((l) => l());
}
