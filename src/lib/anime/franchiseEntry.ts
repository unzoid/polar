/**
 * What a card in Also in This Franchise does when clicked (#192). Pure, so tests can check made-up
 * entries.
 *
 * Polarity plays anime series and films. A manga or novel opens on MyAnimeList or AniList, as Settings
 * → Anime → Open manga and novels on says. An entry Polarity can't play (a music video, or a short ani.zip
 * doesn't know that's only on YouTube) plays its official YouTube video in the trailer player when AniList
 * lists one, else opens on that site like a manga. Everything else opens its page as before: an entry
 * ani.zip doesn't know may still play (the second half of a split part, a show found by its title, one
 * the user picked a show for), so it isn't sent away from its page on that alone.
 */
import type { AnimeCard } from "./anilist";
import { FORMAT_LABEL } from "./format";

export type ReadOn = "myanimelist" | "anilist";

export type EntryAction =
  /** An anime Polarity can play, or might: its page. */
  | { kind: "page" }
  /** Its official YouTube video, in the trailer player; the caption ends "· YouTube". */
  | { kind: "youtube"; ytId: string; badge: string }
  /** Its page on MyAnimeList or AniList, in the browser. */
  | { kind: "site"; url: string; badge: string; site: string };

/** What ani.zip and the stored links say about an entry: undefined while they haven't answered. */
export interface EntryLinks {
  /** ani.zip has no ids or episodes for it. */
  unknown: boolean;
  /** The user's links (docs/anime-identity.md) play it from a show. */
  linked: boolean;
}

const YT_ID = /^[A-Za-z0-9_-]{11}$/;

/** The video id of a YouTube watch, share, embed or Shorts link; undefined for a channel, a playlist or another site. */
export function youtubeVideoId(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return undefined;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return undefined;
  const host = u.hostname.replace(/^(www|m)\./, "");
  let id: string | null | undefined;
  if (host === "youtu.be") id = u.pathname.split("/")[1];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const [, first, second] = u.pathname.split("/");
    id = first === "watch" ? u.searchParams.get("v") : first === "embed" || first === "shorts" ? second : undefined;
  }
  return id && YT_ID.test(id) ? id : undefined;
}

/** The first official YouTube video AniList lists for the entry. */
export function entryYoutubeId(card: Pick<AnimeCard, "externalLinks">): string | undefined {
  for (const l of card.externalLinks ?? []) {
    if (l.site !== "YouTube") continue;
    const id = youtubeVideoId(l.url);
    if (id) return id;
  }
  return undefined;
}

/** What the card's badge calls it. */
export function entryKind(card: Pick<AnimeCard, "type" | "format">): string {
  if (card.type === "MANGA") return card.format === "NOVEL" ? "Light novel" : card.format === "ONE_SHOT" ? "One-shot" : "Manga";
  if (card.format === "MUSIC") return "Music video";
  return card.format ? FORMAT_LABEL[card.format] : "Anime";
}

/** The entry's page on the chosen site; AniList when MyAnimeList doesn't list it. */
export function entrySite(card: Pick<AnimeCard, "id" | "idMal" | "type">, readOn: ReadOn): { url: string; site: string } {
  const kind = card.type === "MANGA" ? "manga" : "anime";
  // Ids are AniList's answer: only whole numbers go into a link.
  if (readOn === "myanimelist" && Number.isSafeInteger(card.idMal) && card.idMal! > 0) return { url: `https://myanimelist.net/${kind}/${card.idMal}`, site: "MyAnimeList" };
  return { url: `https://anilist.co/${kind}/${Number.isSafeInteger(card.id) ? card.id : 0}`, site: "AniList" };
}

/** Whether the card needs ani.zip and the stored links to decide: an anime that isn't a music video, with a YouTube video. */
export const needsEntryLinks = (card: Pick<AnimeCard, "type" | "format" | "externalLinks">) =>
  card.type !== "MANGA" && card.format !== "MUSIC" && entryYoutubeId(card) !== undefined;

export function entryAction(card: AnimeCard, readOn: ReadOn, links?: EntryLinks): EntryAction {
  const badge = entryKind(card);
  const site = () => ({ kind: "site" as const, badge, ...entrySite(card, readOn) });
  if (card.type === "MANGA") return site();
  const ytId = entryYoutubeId(card);
  const playable = card.format !== "MUSIC" && !(ytId && links?.unknown && !links.linked);
  if (playable) return { kind: "page" };
  return ytId ? { kind: "youtube", ytId, badge } : site();
}
