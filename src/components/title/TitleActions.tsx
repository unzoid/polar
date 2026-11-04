import type { ReactNode } from "react";
import type { PlayRequest } from "../../lib/titlePlayback";
import type { MetaPreview } from "../../lib/types";
import { DownloadButton } from "../DownloadButton";
import { Play, Reset, Sources, Trailer } from "../icons";
import { PlaylistButton } from "../Playlists";
import { Button, IconButton } from "../ui/Button";
import { LibraryButton } from "./LibraryButton";
import type { SourcePickerState } from "./SourcePicker";

export type TitleActionsProps = {
  /** What Play and "Choose source" act on; nothing yet (or nothing playable) disables both. */
  request: PlayRequest | null | undefined | false | "";
  picker: SourcePickerState;
  /** The Play button's text ("Resume S2, E3", "Play First Episode"). */
  label: string;
  /** Resuming: the button shows the resume glyph instead of the play triangle. */
  resume: boolean;
  /** Tooltip on Play, e.g. why it's disabled. */
  playTitle?: string;
  /** Pointer on Play: warm its sources. */
  onWarm?: () => void;
  /** Shows the Trailer button. */
  onTrailer?: () => void;
  /** Shows the Library button for this item. */
  item?: MetaPreview;
  /** With `item`: also the playlist and download buttons. */
  playlist?: boolean;
  download?: boolean;
  /** Trailing buttons of the page's own (the backdrop trailer's mute). */
  children?: ReactNode;
};

/**
 * The action row of a title page (docs/ui-components.md U5): Play, Trailer, Library, Playlist,
 * Choose source, Download, in that order, each only where the page has it. TV draws its own
 * column of pills (step 6).
 */
export function TitleActions({ request, picker, label, resume, playTitle, onWarm, onTrailer, item, playlist, download, children }: TitleActionsProps) {
  return (
    <div className="detail-actions">
      <Button variant="primary" className="detail-play" disabled={!request} onClick={() => request && picker.play(request)} onPointerEnter={onWarm} title={playTitle}>
        {resume ? <Reset size={18} strokeWidth={2.5} /> : <Play size={18} fill="currentColor" />}
        {label}
      </Button>
      {onTrailer && (
        <Button variant="glass" className="detail-trailer-btn" onClick={onTrailer}>
          <Trailer size={18} />
          Trailer
        </Button>
      )}
      {item && <LibraryButton item={item} />}
      {item && playlist && <PlaylistButton item={item} />}
      <IconButton variant="glass" disabled={!request} onClick={() => request && picker.choose(request)} label="Choose source" title="Choose source">
        <Sources size={19} />
      </IconButton>
      {item && download && <DownloadButton item={item} />}
      {children}
    </div>
  );
}
