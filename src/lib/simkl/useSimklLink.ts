import { useEffect, useState } from "react";
import { useListSpace } from "../lists/useListLink";
import { getSimklLink, type SimklLink } from "./link";
import { onSimklLinkChange, simklLinkState, type SimklLinkState } from "./linking";

/**
 * The active profile's Simkl link, read again when it links, unlinks or switches.
 * `state` is `undefined` while the keychain is being read.
 */
export function useSimklLink(): { space: string | null; link: SimklLink | undefined; state: SimklLinkState | undefined } {
  const space = useListSpace();
  const [read, setRead] = useState<{ space: string | null; link: SimklLink | undefined }>();
  const [version, setVersion] = useState(0);
  useEffect(() => onSimklLinkChange(() => setVersion((v) => v + 1)), []);
  useEffect(() => {
    let live = true;
    getSimklLink(space).then(
      (link) => live && setRead({ space, link }),
      () => live && setRead({ space, link: undefined }),
    );
    return () => {
      live = false;
    };
  }, [space, version]);
  const link = read?.space === space ? read.link : undefined;
  return { space, link, state: read?.space === space ? simklLinkState(link) : undefined };
}
