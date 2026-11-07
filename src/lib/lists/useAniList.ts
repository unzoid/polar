import { useEffect, useState, useSyncExternalStore } from "react";
import { anilistLink, linkState, onLinkChange, type LinkState } from "./linking";
import type { Link } from "./linkStore";
import { listSpace, onListEntries, seenEntry } from "./listSync";
import type { ListEntry } from "./anilistList";

/** The profile the list sync runs for, following profile switches. */
export function useListSpace(): string | null {
  return useSyncExternalStore(onListEntries, listSpace);
}

/**
 * The active profile's AniList link, read again when it links, unlinks or switches.
 * `undefined` while the keychain is being read.
 */
export function useAniListLink(): { space: string | null; link: Link | undefined; state: LinkState | undefined } {
  const space = useListSpace();
  const [read, setRead] = useState<{ space: string | null; link: Link | undefined }>();
  const [version, setVersion] = useState(0);
  useEffect(() => onLinkChange(() => setVersion((v) => v + 1)), []);
  useEffect(() => {
    let live = true;
    anilistLink(space).then(
      (link) => live && setRead({ space, link }),
      () => live && setRead({ space, link: undefined }),
    );
    return () => {
      live = false;
    };
  }, [space, version]);
  const link = read?.space === space ? read.link : undefined;
  return { space, link, state: read?.space === space ? linkState(link, Date.now()) : undefined };
}

/** What the device keeps of the active profile's entry for `mediaId`, following changes. */
export function useSeenEntry(mediaId: number): ListEntry | undefined {
  const [, setVersion] = useState(0);
  useEffect(() => onListEntries(() => setVersion((v) => v + 1)), []);
  return seenEntry(mediaId, listSpace());
}
