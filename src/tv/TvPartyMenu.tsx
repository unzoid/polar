import { useEffect, useRef } from "react";
import { PartyMenu } from "../components/party/PartyMenu";
import { setPartyMenuOpen, useParty } from "../lib/party";
import { useBack, useFocusTrap } from "./shell";

/**
 * TV mode's party menu (#156): the same items as the desktop's, as a panel
 * the remote moves through. Back closes it; it closes itself when the party
 * ends here.
 */
export function TvPartyMenu() {
  const party = useParty();
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  const close = () => setPartyMenuOpen(false);
  useBack(true, close);
  useEffect(() => {
    if (!party) close();
  }, [party]);
  if (!party) return null;
  return (
    <div className="tv-panel tv-sources tv-party" ref={ref} data-nav-scope role="dialog" aria-label="Watch party">
      <header className="tv-sources-head">
        <h2 className="tv-heading">Watch Party</h2>
      </header>
      <div className="tv-party-body">
        <PartyMenu party={party} onClose={close} />
      </div>
    </div>
  );
}
