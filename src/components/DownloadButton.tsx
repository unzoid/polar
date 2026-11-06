import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  downloadFraction,
  canRevealDownloads,
  pauseDownload,
  removeDownload,
  resumeDownload,
  revealDownload,
  startDownload,
  useDownload,
  type Download as DownloadRecord,
} from "../lib/library";
import { episodeCode } from "../lib/format";
import type { MetaPreview, Video } from "../lib/types";
import { useConfirmDelete, TrashLid } from "./ConfirmDeleteButton";
import { AlertCircle, Download, Folder, Pause, Reset, Trash } from "./icons";
import { Sheet } from "./Sheet";
import { Spinner } from "./Spinner";
import { StreamList } from "./StreamList";
import { buttonClass } from "./ui/Button";
import { MenuHeader, MenuItem, MenuPopup, MenuRoot, MenuSeparator, MenuTrigger } from "./ui/Menu";

/**
 * The download control, as on Netflix and Apple TV: an arrow to start; while
 * it's coming down, a ring that fills (a small square in the middle says
 * "tap to stop"). Starting asks which source, in the same list as Sources, so
 * you choose the quality and size you're saving. Once it's here: Show in Folder
 * (desktop) and a two-step Delete side by side;
 * playing it is the title's own Play, which picks the download first. Every
 * other state opens a short menu - pause, resume, cancel.
 */
export function DownloadButton({
  item,
  video,
  className = buttonClass("glass", true),
  size = 20,
  labelled = false,
}: {
  item: MetaPreview;
  /** The episode, for a show; a movie downloads itself. */
  video?: Video;
  className?: string;
  size?: number;
  /** The title page's button (#26): names what it downloads, "Download S2 E5" or "Download Movie". */
  labelled?: boolean;
}) {
  const videoId = video?.id ?? item.id;
  const { download: d, pending } = useDownload(videoId);
  const [choosing, setChoosing] = useState(false);
  const what = video ? (labelled ? shortCode(video) : "Episode") : "Movie";

  // The glyph pops in when the state changes, not on first paint.
  const settled = useRef(false);
  useEffect(() => {
    settled.current = true;
  }, []);
  const state = pending?.kind === "finding" ? "starting" : (d?.state ?? (pending?.kind === "error" ? "error" : "none"));
  const glyph = (node: ReactNode) => (
    <span key={state} className={settled.current ? "btn-glyph" : "btn-glyph-static"}>
      {node}
    </span>
  );

  const sheet = createPortal(
    <Sheet
      open={choosing}
      onClose={() => setChoosing(false)}
      title="Download"
      subtitle={video ? `${episodeCode(video.season, video.episode)} · ${video.title}` : item.name}
    >
      <StreamList
        type={item.type}
        videoId={videoId}
        onPick={(s) => {
          setChoosing(false);
          void startDownload(item, video, s);
        }}
      />
    </Sheet>,
    document.body,
  );

  let control: ReactNode;
  if (state === "starting") {
    control = (
      <button className={className} data-download="starting" aria-label="Starting download" title="Starting download…" disabled>
        {glyph(<Spinner size={size - 2} />)}
      </button>
    );
  } else if (!d) {
    const failed = pending?.kind === "error" ? pending.message : undefined;
    control = (
      <button
        className={labelled ? buttonClass("glass", false, "download-labelled") : className}
        data-download={failed ? "failed" : "none"}
        onClick={() => setChoosing(true)}
        aria-label={failed ? `Download failed: ${failed}. Choose another source` : `Download ${what}`}
        title={failed ? `${failed} Click to choose another source.` : labelled && video ? `Download ${what} · ${video.title}` : `Download ${what}`}
      >
        {glyph(failed ? <AlertCircle size={labelled ? 18 : size} /> : <Download size={labelled ? 18 : size} />)}
        {labelled && `Download ${what}`}
      </button>
    );
  } else if (d.state === "done") {
    control = <DownloadedActions d={d} className={className} size={size} what={what} />;
  } else {
    control = (
      <DownloadMenu d={d} className={className} what={labelled ? what : undefined} onRetry={() => setChoosing(true)} glyph={glyph(<DownloadGlyph d={d} size={size} />)} />
    );
  }

  return (
    <>
      {control}
      {sheet}
    </>
  );
}

/** A finished download: Show in Folder where there is a file manager, and Delete (click twice). */
function DownloadedActions({ d, className, size, what }: { d: DownloadRecord; className: string; size: number; what: string }) {
  const { armed, props } = useConfirmDelete(() => void removeDownload(d.id), "Delete Download");
  return (
    <>
      {canRevealDownloads && (
        <button
          className={`${className} download-reveal`}
          data-download="done"
          onClick={() => void revealDownload(d.id)}
          aria-label={`Show Downloaded ${what} in Folder`}
          title="Show in Folder"
        >
          <Folder size={size} />
        </button>
      )}
      <button
        className={`${className} confirm-delete`}
        data-download="done"
        aria-label={armed ? `Click again to delete the downloaded ${/^S\d/.test(what) ? what : what.toLowerCase()}` : `Delete Downloaded ${what}`}
        title={armed ? "Click again to delete" : `Delete Download${d.quality ? ` (${d.quality})` : ""}`}
        {...props}
      >
        <TrashLid size={size} />
      </button>
    </>
  );
}

function DownloadMenu({ d, className, glyph, onRetry, what }: { d: DownloadRecord; className: string; glyph: ReactNode; onRetry: () => void; what?: string }) {
  const fraction = downloadFraction(d);
  const of = what ? ` ${what}` : "";
  const label =
    d.state === "failed"
      ? `Download${of} failed${d.error ? `: ${d.error}` : ""}`
      : d.state === "paused"
        ? `Download${of} paused${fraction != null ? `, ${Math.round(fraction * 100)}%` : ""}`
        : `Downloading${of}${fraction != null ? `, ${Math.round(fraction * 100)}%` : ""}`;

  return (
    <MenuRoot modal={false}>
      <MenuTrigger className={className} data-download={d.state} aria-label={label} title={label}>
        {glyph}
      </MenuTrigger>
      <MenuPopup side="bottom" align="center" sideOffset={8} collisionPadding={12} aria-label="Download">
        <MenuHeader title={label.split(":")[0]} detail={d.quality} />
        {d.state === "downloading" && (
          <MenuItem icon={<Pause fill="currentColor" />} onClick={() => void pauseDownload(d.id)}>
            Pause Download
          </MenuItem>
        )}
        {d.state === "paused" && (
          <MenuItem icon={<Download />} onClick={() => void resumeDownload(d.id)}>
            Resume Download
          </MenuItem>
        )}
        {d.state === "failed" && (
          <MenuItem icon={<Reset />} onClick={onRetry}>
            Choose Another Source
          </MenuItem>
        )}
        {canRevealDownloads && d.received > 0 && (
          <MenuItem icon={<Folder />} onClick={() => void revealDownload(d.id)}>
            Show in Folder
          </MenuItem>
        )}
        <MenuSeparator />
        <MenuItem icon={<Trash />} onClick={() => void removeDownload(d.id)}>
          Cancel Download
        </MenuItem>
      </MenuPopup>
    </MenuRoot>
  );
}

/** Ring and centre mark for a download's state; shared with the Library's rows. */
export function DownloadGlyph({ d, size = 20 }: { d: DownloadRecord; size?: number }) {
  if (d.state === "done") return <DoneGlyph size={size} />;
  if (d.state === "failed") return <AlertCircle size={size} />;
  const fraction = downloadFraction(d) ?? 0;
  const r = 9;
  const c = 2 * Math.PI * r;
  return (
    <svg className="download-ring" data-state={d.state} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r={r} fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <circle
        className="download-ring-fill"
        cx="12"
        cy="12"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - fraction)}
        transform="rotate(-90 12 12)"
      />
      {d.state === "paused" ? (
        // Paused: the arrow again, inside the ring - "tap to carry on".
        <path d="M12 8v7m0 0-2.75-2.75M12 15l2.75-2.75" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <rect x="9.25" y="9.25" width="5.5" height="5.5" rx="1" fill="currentColor" />
      )}
    </svg>
  );
}

/** A filled circle with a check: on this device. */
function DoneGlyph({ size }: { size: number }) {
  return (
    <svg className="download-done" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="12" r="10" fill="currentColor" />
      <path d="m7.75 12.25 2.75 2.75 5.75-6" fill="none" stroke="var(--download-check, #0a0a0a)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** "S2 E5": what the title page's button names. */
const shortCode = (v: Video) => `S${v.season} E${v.episode}`;
