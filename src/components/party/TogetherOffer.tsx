import { useEffect, useRef } from "react";
import { Button } from "../ui/Button";
import { BusyLabel } from "../BusyLabel";
import { useLayer } from "../../lib/ui";
import { closePartySurface, confirmTogether, dismissTogether, openPartySurface, useTogether } from "../../lib/party";
import { formatTime } from "../../lib/format";

/**
 * "Watch together in Polarity" from the browser extension (#208): the video's link in full, and what the
 * page called itself, before a party starts on it (lib/party/together.ts). A page can't start a party by
 * itself. A party surface while it's up; Escape is Cancel; works with a remote in TV mode.
 */
export function TogetherOffer() {
  const offer = useTogether();
  const up = !!offer;
  useEffect(() => {
    if (!up) return;
    openPartySurface("together");
    return () => closePartySurface("together");
  }, [up]);
  const root = useRef<HTMLDivElement>(null);
  useLayer(root, up, dismissTogether);
  if (!offer) return null;
  return (
    <div className="party-link-confirm" role="dialog" aria-modal="true" aria-labelledby="party-together-title" ref={root} tabIndex={-1} data-layer data-nav-scope>
      <div className="party-link-card">
        <h2 id="party-together-title" className="t-title2">
          {offer.error ? "Couldn't watch together" : "Watch together?"}
        </h2>
        {offer.name && (
          <p className="t-callout party-together-name" data-testid="party-together-name">
            “{offer.name}”
          </p>
        )}
        <p className="t-callout">
          {offer.inParty ? "Your browser asks to put this on for everyone in your party:" : "Your browser asks to start a watch party with this video:"}
        </p>
        <p className="party-link-url" data-testid="party-link-url">
          {offer.url}
        </p>
        <p className="t-callout" role={offer.error ? "alert" : undefined} data-testid="party-together-note">
          {offer.error ?? (offer.at > 0 ? `It starts at ${formatTime(offer.at)}, where you were.` : "Everyone who joins plays it from this address.")}
        </p>
        <div className="player-status-actions">
          <Button variant={offer.error ? "primary" : "glass"} onClick={dismissTogether} autoFocus={!!offer.error}>
            {offer.error ? "OK" : "Cancel"}
          </Button>
          {!offer.error && (
            <Button variant="primary" onClick={() => confirmTogether()} disabled={offer.busy} aria-busy={offer.busy} autoFocus>
              <BusyLabel busy={!!offer.busy}>Watch Together</BusyLabel>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
