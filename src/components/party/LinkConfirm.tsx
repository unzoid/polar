import { useRef } from "react";
import { Button } from "../ui/Button";
import { useLayer } from "../../lib/ui";

/**
 * A link someone in the watch party put on (#136), shown in full before this app opens it, so nobody is
 * sent somewhere they didn't expect. Escape is Not Now. Works with a remote in TV mode (its own nav scope).
 */
export function LinkConfirm({ url, from, onPlay, onLater }: { url: string; from?: string; onPlay: () => void; onLater: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useLayer(root, true, onLater);
  return (
    <div className="party-link-confirm" role="dialog" aria-modal="true" aria-labelledby="party-link-title" ref={root} tabIndex={-1} data-layer data-nav-scope>
      <div className="party-link-card">
        <h2 id="party-link-title" className="t-title2">
          {from ? `${from} put on a link` : "The party put on a link"}
        </h2>
        <p className="t-callout">Your app opens it itself, from this address:</p>
        <p className="party-link-url" data-testid="party-link-url">
          {url}
        </p>
        <p className="t-callout">Play it only if you trust where it goes.</p>
        <div className="player-status-actions">
          <Button variant="glass" onClick={onLater}>
            Not Now
          </Button>
          <Button variant="primary" onClick={onPlay} autoFocus>
            Play
          </Button>
        </div>
      </div>
    </div>
  );
}
