import { storeLocal } from "../errors";
import { isRecord, num, storedJson } from "../parse";
import type { SimklCaller } from "./api";
import { polarityIdsOf, SIMKL_KINDS, type SimklKind } from "./items";
import { pendingSimklOps } from "./queue";

/**
 * The profile's Simkl ratings (#86), kept on the device so a title page shows its rating without
 * asking Simkl: read from Simkl when its ratings moved (pull.ts), changed here at once when the
 * profile rates a title (simklSync.ts sends it), dropped when the profile unlinks. Keyed by each
 * Polarity id the title has (its IMDb id, and an anime's `kitsu:N` too); ratings are Simkl's 1–10.
 */
export type SimklRatings = Record<string, number>;

export const simklRatingsKey = (space: string | null) => `polar.simkl.ratings.${space ?? "local"}`;

const ID = /^(tt\d{1,10}|kitsu:\d{1,10})$/;

/** A rating Simkl takes: a whole number from 1 to 10 (Simkl files anything else under `not_found` and still answers 201). */
export const validSimklRating = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 1 && n <= 10;

export function readSimklRatings(v: unknown): SimklRatings {
  const out: SimklRatings = {};
  if (!isRecord(v)) return out;
  for (const [id, n] of Object.entries(v)) if (ID.test(id) && validSimklRating(n)) out[id] = n;
  return out;
}

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** The profile's ratings; `undefined` when they were never read from Simkl. */
export function simklRatings(space: string | null, storage: Pick<Storage, "getItem"> = localStorage): SimklRatings | undefined {
  const v = storedJson(storage, simklRatingsKey(space));
  return v === undefined ? undefined : readSimklRatings(v);
}

const listeners = new Set<() => void>();

/** Hear when the profile's ratings change; returns the function that stops listening. */
export function onSimklRatings(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function write(space: string | null, ratings: SimklRatings, storage: Store) {
  storeLocal(simklRatingsKey(space), JSON.stringify(ratings), storage);
  listeners.forEach((l) => l());
}

/** One title's rating set (1–10) or taken off (`null`) on the device. */
export function keepSimklRating(space: string | null, id: string, rating: number | null, storage: Store = localStorage) {
  const ratings = { ...simklRatings(space, storage) };
  if (rating === null) delete ratings[id];
  else ratings[id] = rating;
  write(space, ratings, storage);
}

/** Answer keys and the kind each holds (Simkl's ratings answers list anime under `anime`). */
const ANSWER: Record<string, SimklKind> = { movies: "movies", shows: "shows", anime: "anime" };

/**
 * The rows of a `/sync/ratings/{type}` answer as Polarity ids and their rating, `null` where the
 * profile took the rating off (only in a `date_from` read).
 */
export function simklRatingRows(answer: unknown): [string, number | null][] {
  const out: [string, number | null][] = [];
  if (!isRecord(answer)) return out;
  for (const [key, kind] of Object.entries(ANSWER)) {
    const list = answer[key];
    if (!Array.isArray(list)) continue;
    for (const v of list) {
      if (!isRecord(v)) continue;
      const title = isRecord(v.movie) ? v.movie : isRecord(v.show) ? v.show : isRecord(v.anime) ? v.anime : undefined;
      if (!title) continue;
      const rating = v.user_rating === null ? null : num(v.user_rating);
      if (rating !== null && !validSimklRating(rating)) continue;
      for (const id of polarityIdsOf(kind, title.ids)) out.push([id, rating]);
    }
  }
  return out;
}

/** Every rating at once: Simkl lists only titles actually rated when given every score. */
const EVERY = "1,2,3,4,5,6,7,8,9,10";

/**
 * Reads the profile's ratings from Simkl into what the device keeps. `since` unset reads every kind
 * whole, in place of what the device had; with `since` (the last look's `all`) only the `kinds`
 * given, what changed after it, on top of what the device had. Ratings made here that are still
 * waiting to go out stay on top. Returns how many it kept.
 */
export async function pullSimklRatings(
  space: string | null,
  caller: SimklCaller,
  get: (path: string, query: Record<string, string>, caller: SimklCaller) => Promise<unknown>,
  storage: Store,
  since?: { all: string; kinds: readonly SimklKind[] },
) {
  const ratings: SimklRatings = since ? { ...simklRatings(space, storage) } : {};
  for (const kind of since ? since.kinds : SIMKL_KINDS) {
    const answer = since ? await get(`/sync/ratings/${kind}`, { date_from: since.all }, caller) : await get(`/sync/ratings/${kind}/${EVERY}`, {}, caller);
    for (const [id, rating] of simklRatingRows(answer)) {
      if (rating === null) delete ratings[id];
      else ratings[id] = rating;
    }
  }
  for (const op of pendingSimklOps(space, storage)) {
    if (op.list !== "ratings" || op.ref.kind === "episode") continue;
    const id = "imdb" in op.ref.ids ? op.ref.ids.imdb : `kitsu:${op.ref.ids.kitsu}`;
    if (op.remove) delete ratings[id];
    else if (validSimklRating(op.extra?.rating)) ratings[id] = op.extra.rating;
  }
  write(space, ratings, storage);
  return Object.keys(ratings).length;
}

/** Forgets the profile's ratings (unlinking). */
export function forgetSimklRatings(space: string | null, storage: Pick<Storage, "removeItem"> = localStorage) {
  storage.removeItem(simklRatingsKey(space));
  listeners.forEach((l) => l());
}
