import { useEffect, useState, useSyncExternalStore } from "react";
import type { ListEntry } from "./entry";
import { linkState, listLink, onLinkChange, type LinkState } from "./linking";
import type { Link, ListService } from "./linkStore";
import { listSpace, onListEntries, seenEntry } from "./listSync";

/** The profile the list sync runs for, following profile switches. */
export function useListSpace(): string | null {
  return useSyncExternalStore(onListEntries, listSpace);
}

/**
 * The active profile's link to `service`, read again when it links, unlinks or switches.
 * `undefined` while the keychain is being read.
 */
export function useListLink(service: ListService): { space: string | null; link: Link | undefined; state: LinkState | undefined } {
  const space = useListSpace();
  const [read, setRead] = useState<{ space: string | null; link: Link | undefined }>();
  const [version, setVersion] = useState(0);
  useEffect(() => onLinkChange(() => setVersion((v) => v + 1)), []);
  useEffect(() => {
    let live = true;
    listLink(service, space).then(
      (link) => live && setRead({ space, link }),
      () => live && setRead({ space, link: undefined }),
    );
    return () => {
      live = false;
    };
  }, [service, space, version]);
  const link = read?.space === space ? read.link : undefined;
  return { space, link, state: read?.space === space ? linkState(link, Date.now()) : undefined };
}

/** What the device keeps of the active profile's entry for `mediaId` on `service`, following changes. */
export function useSeenEntry(service: ListService, mediaId: number): ListEntry | undefined {
  const [, setVersion] = useState(0);
  useEffect(() => onListEntries(() => setVersion((v) => v + 1)), []);
  return seenEntry(service, mediaId, listSpace());
}
