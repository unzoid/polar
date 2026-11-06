import { useRef } from "react";
import { Button } from "../ui/Button";
import { SliderField } from "../SliderField";
import { shownNumber, storedNumber, useSetting } from "../../lib/settings";
import { useLayer } from "../../lib/ui";

/**
 * Shown once per device, before the first torrent source plays (#137): what torrent playback does
 * with the connection, the upload limit, and Play or Cancel. Escape cancels. `onSettings` is left
 * out where the torrent settings aren't shown (TV mode).
 */
export function TorrentNotice({ onPlay, onCancel, onSettings }: { onPlay: () => void; onCancel: () => void; onSettings?: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useLayer(root, true, onCancel);
  const upload = useSetting("torrentUploadMbps");
  const control = upload.def.control;

  return (
    <div className="torrent-notice" role="dialog" aria-modal="true" aria-labelledby="torrent-notice-title" ref={root} tabIndex={-1} data-layer>
      <div className="torrent-notice-card">
        <h2 id="torrent-notice-title" className="t-title2">
          Torrent playback
        </h2>
        <p className="t-callout">
          This source is a torrent from your add-on. While it plays, Polarity downloads the file from other people who share it and
          uploads the parts it has to them. They can see your IP address.
        </p>
        <p className="t-callout">You're responsible for what you play.</p>
        {control?.kind === "number" && (
          <div className="torrent-notice-limit">
            <span className="t-callout">Upload limit</span>
            <SliderField
              label="Upload limit"
              value={shownNumber(control, Number(upload.value))}
              min={control.min}
              max={control.max}
              step={control.step}
              unit={control.unit}
              zero={control.zero}
              onChange={(n) => upload.set(storedNumber(control, n))}
            />
          </div>
        )}
        {onSettings && (
          <button className="settings-link" onClick={onSettings}>
            Settings → Sources → Torrent Sources
          </button>
        )}
        <div className="player-status-actions">
          <Button variant="glass" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onPlay} autoFocus>
            Play
          </Button>
        </div>
      </div>
    </div>
  );
}
