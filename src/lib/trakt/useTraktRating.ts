import { useEffect, useState } from "react";
import type { ContentType } from "../types";
import { traktRefOf } from "./items";
import { onTraktRatings, traktRatings } from "./ratings";
import { rateTrakt } from "./traktSync";
import { useTraktLink } from "./useTraktLink";

/**
 * A title's Trakt rating for its page (#85): `undefined` unless the active profile has a usable
 * Trakt link and Trakt can be told about the title (a `tt…` film or show). `rating` is 1–10, or
 * `null` when the profile hasn't rated it; `rate` sets it or (with `null`) takes it off.
 */
export function useTraktRating(item: { id: string; type: ContentType }): { rating: number | null; rate: (rating: number | null) => void } | undefined {
  const { space, state } = useTraktLink();
  const [, setVersion] = useState(0);
  useEffect(() => onTraktRatings(() => setVersion((v) => v + 1)), []);
  const ref = traktRefOf(item.id, item.type);
  if (state !== "linked" || !ref || ref.kind === "episode") return undefined;
  return { rating: traktRatings(space)?.[ref.imdb] ?? null, rate: (rating) => void rateTrakt(item, rating) };
}
