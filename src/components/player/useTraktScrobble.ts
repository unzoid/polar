import { liveTraktLink, noteTraktWatched, scrobble, sendScrobble, traktRefOf, traktSpace, type TraktRef } from "../../lib/trakt";
import { useScrobble, type Scrobbler } from "./useScrobble";

/**
 * Tells a linked Trakt account what plays (#85), through {@link useScrobble}. A video Polarity
 * counts watched that Trakt's stop didn't (stopped under Trakt's 80%, or Trakt out of reach) goes
 * into the Trakt history queue instead, so both agree.
 */
const trakt: Scrobbler<TraktRef> = {
  refOf: traktRefOf,
  send: (ref, action, progress) =>
    scrobble(action, ref, progress, {
      liveLink: (renew) => liveTraktLink(traktSpace(), renew),
      send: sendScrobble,
    }),
  missed: (videoId, type) => void noteTraktWatched([{ videoId, type }], true),
};

export const useTraktScrobble = (props: Parameters<typeof useScrobble>[1]) => useScrobble(trakt, props);
