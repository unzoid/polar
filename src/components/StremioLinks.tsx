import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { linkHasKey } from "../lib/account";
import { clearLinkNote, confirmAddon, dismissAddonOffer, showLinkNote, useAddonOffer, useLinkNote, type AddonOffer } from "../lib/deepLink";
import { keys } from "../lib/net";
import { useLayer, usePresence } from "../lib/ui";
import { useKeyGate } from "./settings/KeyWarning";
import { Button } from "./ui/Button";
import { TOAST_OUT_MS, Toast } from "./ui/Toast";

const NOTE_MS = 8000;

/**
 * What a stremio:// link leaves on screen (#163): the add-on an install link points at, with Install
 * and Cancel (in the watch-party link card's style, TV remotes included), and the short note of a
 * link Polarity couldn't open.
 */
export function StremioLinks({ tv }: { tv: boolean }) {
  const offer = useAddonOffer();
  return (
    <>
      {offer && <OfferCard key={offer.id} offer={offer} />}
      <LinkNote tv={tv} />
    </>
  );
}

function OfferCard({ offer }: { offer: AddonOffer }) {
  const qc = useQueryClient();
  const gate = useKeyGate();
  const root = useRef<HTMLDivElement>(null);
  useLayer(root, true, dismissAddonOffer);
  const install = () =>
    void confirmAddon({ preview: api.previewAddon, install: api.installAddon }).then((name) => {
      if (!name) return;
      void qc.invalidateQueries({ queryKey: keys.addons });
      void qc.invalidateQueries({ queryKey: keys.streamsAll });
      showLinkNote(`${name} is installed.`);
    });
  const title = offer.step === "error" ? "Couldn't read this add-on" : offer.step === "loading" ? "Reading the add-on…" : `Install ${offer.name}?`;
  return (
    <div className="party-link-confirm" role="dialog" aria-modal="true" aria-labelledby="addon-offer-title" ref={root} tabIndex={-1} data-layer data-nav-scope data-testid="addon-offer">
      <div className="party-link-card">
        <h2 id="addon-offer-title" className="t-title2">
          {title}
        </h2>
        {(offer.step === "confirm" || offer.step === "installing") && offer.description && <p className="t-callout">{offer.description}</p>}
        {offer.step === "error" && (
          <p className="t-callout" role="alert">
            {offer.error}
          </p>
        )}
        <p className="t-callout">A link asks to install this add-on. Add-ons are made by others: install only the ones you trust.</p>
        <p className="party-link-url" data-testid="addon-offer-url">
          {offer.manifestUrl}
        </p>
        {gate.warning}
        <div className="player-status-actions">
          {/* Cancel holds the focus: Enter never installs by accident. */}
          <Button variant="glass" onClick={dismissAddonOffer} autoFocus>
            {offer.step === "error" ? "Close" : "Cancel"}
          </Button>
          {offer.step !== "error" && (
            <Button
              variant="primary"
              onClick={() => gate.guard(linkHasKey(offer.manifestUrl) ? "link" : null, install)}
              disabled={offer.step !== "confirm"}
            >
              {offer.step === "installing" ? "Installing…" : "Install"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function LinkNote({ tv }: { tv: boolean }) {
  const note = useLinkNote();
  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => clearLinkNote(note.id), NOTE_MS);
    return () => clearTimeout(t);
  }, [note]);
  const { shown, leaving } = usePresence(note, TOAST_OUT_MS);
  if (!shown) return null;
  return (
    <Toast variant={tv ? "tv" : undefined} lines leaving={leaving} data-kind="link-note">
      <span>{shown.text}</span>
    </Toast>
  );
}
