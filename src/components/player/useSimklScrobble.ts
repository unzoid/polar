import { liveSimklLink, noteSimklWatched, scrobbleSimkl, sendSimklScrobble, simklRefOf, simklSpace, type SimklRef } from "../../lib/simkl";
import { useScrobble, type Scrobbler } from "./useScrobble";

/**
 * Tells a linked Simkl account what plays (#86), through {@link useScrobble}. A video Polarity
 * counts watched that Simkl's stop didn't (stopped under Simkl's 80%, or Simkl out of reach) goes
 * into the Simkl history queue instead, so both agree.
 */
const simkl: Scrobbler<SimklRef> = {
  refOf: simklRefOf,
  send: (ref, action, progress) =>
    scrobbleSimkl(action, ref, progress, {
      liveLink: (renew) => liveSimklLink(simklSpace(), renew),
      send: sendSimklScrobble,
    }),
  missed: (videoId, type) => void noteSimklWatched([{ videoId, type }], true),
};

export const useSimklScrobble = (props: Parameters<typeof useScrobble>[1]) => useScrobble(simkl, props);
