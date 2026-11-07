/**
 * Watching a video together from outside Polarity (#208): the browser extension's "Watch together in
 * Polarity" opens a polarity://together link (lib/deepLink) with a YouTube video or a direct video
 * link. Nothing starts until the user says so on the card that shows the link (components/party/
 * TogetherOffer.tsx); then it's Watch a Link (#136, #201): the same check, the same party.
 */
import { useSyncExternalStore } from "react";
import { api } from "../api";
import type { Readiness } from "../types";
import { checkLink, isStreamLink, linkMedia, youtubeId, youtubeLinkProblem } from "./links";
import type { Member } from "./room";
import { getParty, partyAct, startParty } from "./party";

type Me = Pick<Member, "name" | "avatar">;

/** What the readiness check says of a web page (crates/addon probe.rs). */
const PAGE = "Answered with a page, not a video";

/**
 * Puts `input` on for the whole party from `position` seconds, or opens a party on it: once it's a web
 * link that answers with a video, or a YouTube video's link, which plays in YouTube's own embedded
 * player (#201). Other video pages (a site's page around its player) aren't played: the player opens
 * files and HLS/DASH streams only. PartyHost then opens it here, and asks everyone else first.
 * Resolves with what's wrong, or null once it's on; nothing starts if `wanted` says no by then.
 */
export async function watchLink(
  input: string,
  me: Me,
  { position = 0, ready = api.streamReady, wanted = () => true }: { position?: number; ready?: (url: string) => Promise<Readiness>; wanted?: () => boolean } = {},
): Promise<string | null> {
  const link = checkLink(input);
  if (!link.ok) return link.reason;
  const problem = youtubeLinkProblem(link.url);
  if (problem) return problem;
  // YouTube's player opens it: there's no file to check.
  if (!youtubeId(link.url)) {
    let r: Readiness;
    try {
      r = await ready(link.url);
    } catch (e) {
      return `That link couldn't be checked: ${(e as Error).message}`;
    }
    // A stream's manifest may come as plain text; the player reads it all the same.
    if (r.state === "notReady" && !(r.reason === PAGE && isStreamLink(link.url))) {
      return r.reason === PAGE
        ? "That page isn't a video Polarity can play. Paste a YouTube video's link, or the address of a video file or stream (.mp4, .mkv, .m3u8, .mpd…)."
        : `That link didn't play: ${r.reason}.`;
    }
  }
  if (!wanted()) return null;
  const media = linkMedia(link.url);
  if (getParty()?.playback) partyAct({ media, position, paused: false });
  else startParty(media, position, false, me);
  return null;
}

export type TogetherOffer = {
  id: number;
  url: string;
  /** Seconds in, where the browser was. */
  at: number;
  /** What the page called itself: shown as that, never as Polarity's word for it. */
  name?: string;
  /** Whether it replaces what a party is watching now. */
  inParty: boolean;
  busy?: boolean;
  error?: string;
};

let offer: TogetherOffer | null = null;
let me: Me | null = null;
let nextOffer = 1;
const listeners = new Set<() => void>();
const setOffer = (next: TogetherOffer | null) => {
  offer = next;
  listeners.forEach((l) => l());
};

/** A polarity://together link opened: asks first (`confirmTogether`). `profile` is null when not signed in. */
export function offerTogether(link: { url: string; at: number; name?: string }, profile: Me | null) {
  // One already being asked stays: a page sending another just as the user presses Watch Together
  // mustn't swap what they agreed to. Once it's answered or closed, the next one can come.
  if (offer && !offer.error) return;
  me = profile;
  const id = nextOffer++;
  const party = getParty();
  setOffer({ id, ...link, inParty: !!party?.playback });
  if (!profile) setOffer({ ...offer!, error: "Sign in to Polarity to watch together." });
  else if (party && !party.playback) setOffer({ ...offer!, error: "You're joining a watch party. Try again once you're in." });
}

/** "Watch Together" on the card. */
export function confirmTogether(ready?: (url: string) => Promise<Readiness>) {
  const at = offer;
  if (!at || at.busy || at.error || !me) return;
  const mine = () => offer?.id === at.id;
  setOffer({ ...at, busy: true });
  void watchLink(at.url, me, { position: at.at, ready, wanted: mine }).then((error) => {
    if (mine()) setOffer(error ? { ...at, busy: false, error } : null);
  });
}

export const dismissTogether = () => setOffer(null);

export function useTogether() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    () => offer,
  );
}
