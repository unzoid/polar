import { useEffect, useState } from "react";
import { useListSpace } from "../lists/useListLink";
import { getTraktLink, type TraktLink } from "./link";
import { onTraktLinkChange, traktLinkState, type TraktLinkState } from "./linking";

/**
 * The active profile's Trakt link, read again when it links, unlinks or switches.
 * `state` is `undefined` while the keychain is being read.
 */
export function useTraktLink(): { space: string | null; link: TraktLink | undefined; state: TraktLinkState | undefined } {
  const space = useListSpace();
  const [read, setRead] = useState<{ space: string | null; link: TraktLink | undefined }>();
  const [version, setVersion] = useState(0);
  useEffect(() => onTraktLinkChange(() => setVersion((v) => v + 1)), []);
  useEffect(() => {
    let live = true;
    getTraktLink(space).then(
      (link) => live && setRead({ space, link }),
      () => live && setRead({ space, link: undefined }),
    );
    return () => {
      live = false;
    };
  }, [space, version]);
  const link = read?.space === space ? read.link : undefined;
  return { space, link, state: read?.space === space ? traktLinkState(link) : undefined };
}
