import { Menu } from "@base-ui/react/menu";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  downloadFraction,
  localStream,
  pauseDownload,
  removeDownload,
  resumeDownload,
  revealDownload,
  startDownload,
  useDownload,
  type Download as DownloadRecord,
} from "../lib/downloads";
import { episodeCode } from "../lib/format";
import { useRouter } from "../lib/router";
import type { MetaPreview, Video } from "../lib/types";
import { AlertCircle, Download, Folder, Pause, Play, Reset, Trash } from "./icons";
import { Sheet } from "./Sheet";
import { Spinner } from "./Spinner";
import { StreamList } from "./StreamList";
import { buttonClass } from "./ui/Button";

/**
 * The download control, as on Netflix and Apple TV: an arrow to start; while
 * it's coming down, a ring that fills (a small square in the middle says
 * "tap to stop"); once it's here, a check. Starting asks which source, in the
 * same list as Sources, so you choose the quality and size you're saving.
 * Every other state opens a short menu - pause, resume, play, delete.
 */
export function DownloadButton({
  item,
  video,
  className = buttonClass("glass", true),
  size = 20,
}: {
  item: MetaPreview;
  /** The episode, for a show; a movie downloads itself. */
  video?: Video;
  className?: string;
  size?: number;
}) {
  const videoId = video?.id ?? item.id;
  const { download: d, pending } = useDownload(videoId);
  const [choosing, setChoosing] = useState(false);
  const what = video ? "Episode" : "Movie";

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
        className={className}
        data-download={failed ? "failed" : "none"}
        onClick={() => setChoosing(true)}
        aria-label={failed ? `Download failed: ${failed}. Choose another source` : `Download ${what}`}
        title={failed ? `${failed} Click to choose another source.` : `Download ${what}`}
      >
        {glyph(failed ? <AlertCircle size={size} /> : <Download size={size} />)}
      </button>
    );
  } else {
    control = <DownloadMenu d={d} className={className} onRetry={() => setChoosing(true)} glyph={glyph(<DownloadGlyph d={d} size={size} />)} />;
  }

  return (
    <>
      {control}
      {sheet}
    </>
  );
}

function DownloadMenu({ d, className, glyph, onRetry }: { d: DownloadRecord; className: string; glyph: ReactNode; onRetry: () => void }) {
  const { navigate } = useRouter();
  const fraction = downloadFraction(d);
  const label =
    d.state === "done"
      ? "Downloaded"
      : d.state === "failed"
        ? `Download failed${d.error ? `: ${d.error}` : ""}`
        : d.state === "paused"
          ? `Download paused${fraction != null ? `, ${Math.round(fraction * 100)}%` : ""}`
          : `Downloading${fraction != null ? `, ${Math.round(fraction * 100)}%` : ""}`;

  return (
    <Menu.Root modal={false}>
      <Menu.Trigger className={className} data-download={d.state} aria-label={label} title={label}>
        {glyph}
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="center" sideOffset={8} collisionPadding={12} className="select-positioner">
          <Menu.Popup className="ctx-menu" aria-label="Download">
            <div className="ctx-menu-head">
              <strong>{label.split(":")[0]}</strong>
              <span>{d.quality}</span>
            </div>
            {d.state === "done" && (
              <Item
                icon={<Play fill="currentColor" />}
                label="Play Download"
                onClick={() => navigate({ name: "player", type: d.type, metaId: d.metaId, videoId: d.id, stream: localStream(d) })}
              />
            )}
            {d.state === "downloading" && <Item icon={<Pause fill="currentColor" />} label="Pause Download" onClick={() => void pauseDownload(d.id)} />}
            {d.state === "paused" && <Item icon={<Download />} label="Resume Download" onClick={() => void resumeDownload(d.id)} />}
            {d.state === "failed" && <Item icon={<Reset />} label="Choose Another Source" onClick={onRetry} />}
            {d.received > 0 && <Item icon={<Folder />} label="Show in Folder" onClick={() => void revealDownload(d.id)} />}
            <Menu.Separator className="ctx-menu-sep" />
            <Item
              icon={<Trash />}
              label={d.state === "done" ? "Delete Download" : "Cancel Download"}
              onClick={() => void removeDownload(d.id)}
            />
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
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

function Item({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <Menu.Item className="ctx-menu-item" onClick={onClick}>
      {icon}
      <span>{label}</span>
    </Menu.Item>
  );
}
