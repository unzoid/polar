import { useEffect, useState } from "react";
import type { ContentType } from "../types";
import { simklAppVersion } from "./api";
import { simklRefOf, type SimklKind, type SimklStatus } from "./items";
import { simklPageUrl } from "./page";
import { onSimklItems, simklItems } from "./pull";
import { onSimklRatings, simklRatings } from "./ratings";
import { rateSimkl, setSimklStatus } from "./simklSync";
import { useSimklLink } from "./useSimklLink";

export interface SimklTitle {
  kind: SimklKind;
  /** The list the title is on, `null` when on none. */
  status: SimklStatus | null;
  /** 1–10, `null` when the profile hasn't rated it. */
  rating: number | null;
  setStatus: (status: SimklStatus | null) => void;
  rate: (rating: number | null) => void;
  /** The title's page on Simkl (page.ts). */
  pageUrl: () => Promise<string | undefined>;
}

/**
 * A title's place on the profile's Simkl lists for its page (#86): `undefined` unless the active
 * profile has a usable Simkl link and Simkl can be told about the title (a `tt…` or `kitsu:N` film
 * or show). What it shows is what the device keeps (pull.ts, ratings.ts); changes go out through
 * the queue.
 */
export function useSimklTitle(item: { id: string; type: ContentType }): SimklTitle | undefined {
  const { space, state } = useSimklLink();
  const [, setVersion] = useState(0);
  useEffect(() => {
    const again = () => setVersion((v) => v + 1);
    const offItems = onSimklItems(again);
    const offRatings = onSimklRatings(again);
    return () => {
      offItems();
      offRatings();
    };
  }, []);
  const ref = simklRefOf(item.id, item.type);
  if (state !== "linked" || !ref || ref.kind === "episode") return undefined;
  const listed = simklItems(space)[item.id];
  return {
    kind: ref.kind === "movie" ? "movies" : "kitsu" in ref.ids ? "anime" : "shows",
    status: listed?.status ?? null,
    rating: simklRatings(space)?.[item.id] ?? null,
    setStatus: (status) => void setSimklStatus(item, status),
    rate: (rating) => void rateSimkl(item, rating),
    pageUrl: async () => simklPageUrl(item, listed, await simklAppVersion()),
  };
}
