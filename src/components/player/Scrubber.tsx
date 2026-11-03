import { useEffect, useRef, useState } from "react";
import { formatTime } from "../../lib/format";
import { preloadImage } from "../../lib/queries";
import type { SeekCue, SeekTrack, Span } from "../../lib/types";
import { isMpv, type MediaLike, type MpvChapter } from "./mpvMedia";

/** Rendered thumbnail width; tiles are cropped from the sheet and scaled to this. */
const PREVIEW_W = 240;

/**
 * The timeline. Everything that changes per frame (fill, knob, buffered
 * ranges, hover position, thumbnail) is written straight to `style` from a
 * rAF loop or pointer handler — never through React state — so scrubbing
 * costs no renders beyond the time label.
 *
 * Dragging tracks the pointer 1:1 (with pointer capture, so leaving the bar
 * doesn't drop the drag) and commits the seek on release: network streams
 * shouldn't be asked to seek 60 times a second.
 *
 * Thumbnails (optional) come from a Seekr track: one tile per ~10s cue, cut
 * out of a sprite sheet with background-position — no canvas, no decoding.
 */
export function Scrubber({
  media: video,
  previews,
  span,
  onSeek,
}: {
  /** The intro, when IntroDB knows it: shown as a faint band on the bar. */
  span?: Span | null;
  /** A <video> or the mpv-backed equivalent. */
  media: MediaLike | null;
  /** Seekr thumbnail track, when the feature is on and the title has one. */
  previews?: SeekTrack | null;
  onSeek: (t: number) => void;
}) {
  const bar = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  const buffered = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const tile = useRef<HTMLDivElement>(null);
  const scrubbing = useRef<number | null>(null); // fraction while dragging
  const [tipText, setTipText] = useState("0:00");
  const [chapters, setChapters] = useState<MpvChapter[]>([]);
  const [dur, setDur] = useState(0);

  // Chapters (mpv only) and the duration they're laid out against.
  useEffect(() => {
    if (!video) return;
    const sync = () => {
      setChapters(isMpv(video) ? [...video.chapters] : []);
      setDur(video.duration || 0);
    };
    sync();
    for (const e of ["chapters", "loadedmetadata", "durationchange"]) video.addEventListener(e, sync);
    return () => {
      for (const e of ["chapters", "loadedmetadata", "durationchange"]) video.removeEventListener(e, sync);
    };
  }, [video]);

  // Warm the first sheets so the first hover isn't blank.
  useEffect(() => {
    const sheets = [...new Set(previews?.cues.map((c) => c.sheet))];
    sheets.slice(0, 2).forEach(preloadImage);
  }, [previews]);

  // Paint loop: follows the video unless the user holds the knob.
  useEffect(() => {
    if (!video) return;
    let raf = 0;
    const paint = () => {
      const d = video.duration || 0;
      const f = scrubbing.current ?? (d ? video.currentTime / d : 0);
      if (fill.current) fill.current.style.transform = `scaleX(${f})`;
      if (knob.current) knob.current.style.transform = `translateX(${f * (bar.current?.clientWidth ?? 0)}px)`;
      if (buffered.current && d && video.buffered.length) {
        // The buffered range that contains the playhead.
        let end = 0;
        for (let i = 0; i < video.buffered.length; i++) {
          if (video.buffered.start(i) <= video.currentTime + 1) end = Math.max(end, video.buffered.end(i));
        }
        buffered.current.style.transform = `scaleX(${end / d})`;
      }
      raf = requestAnimationFrame(paint);
    };
    raf = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(raf);
  }, [video]);

  const fractionAt = (clientX: number) => {
    const r = bar.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };

  const showTile = (seconds: number) => {
    const el = tile.current;
    const durationMs = (video?.duration || 0) * 1000;
    if (!el || !previews || !durationMs) return;
    // A different release of the title (extra logo, black frames) shifts the whole
    // preview timeline by a constant: the sprites' source duration minus ours.
    const offset = previews.sourceDurationMs ? previews.sourceDurationMs - durationMs : 0;
    const cue = nearestCue(previews.cues, seconds * 1000 + offset);
    if (!cue) return;
    el.style.width = `${cue.w}px`;
    el.style.height = `${cue.h}px`;
    el.style.backgroundImage = `url("${cue.sheet}")`;
    el.style.backgroundPosition = `-${cue.x}px -${cue.y}px`;
    el.style.transform = `scale(${PREVIEW_W / cue.w})`;
    preloadImage(cue.sheet);
  };

  const showTip = (clientX: number) => {
    const f = fractionAt(clientX);
    const w = bar.current!.clientWidth;
    const tw = tip.current?.offsetWidth ?? 0;
    // Keep the bubble inside the bar's edges.
    const x = Math.min(w - tw / 2, Math.max(tw / 2, f * w));
    if (tip.current) tip.current.style.transform = `translateX(${x - tw / 2}px)`;
    const t = f * (video?.duration || 0);
    setTipText(formatTime(t));
    showTile(t);
  };

  return (
    <div
      className="scrubber"
      ref={bar}
      role="slider"
      aria-label="Seek"
      aria-valuemin={0}
      aria-valuemax={Math.round(video?.duration || 0)}
      aria-valuenow={Math.round(video?.currentTime || 0)}
      tabIndex={-1}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        scrubbing.current = fractionAt(e.clientX); // jump to the press point immediately
        e.currentTarget.dataset.scrubbing = "true";
        showTip(e.clientX);
      }}
      onPointerMove={(e) => {
        showTip(e.clientX);
        if (scrubbing.current != null) scrubbing.current = fractionAt(e.clientX);
      }}
      onPointerUp={(e) => {
        if (scrubbing.current == null) return;
        const f = fractionAt(e.clientX);
        e.currentTarget.dataset.scrubbing = "false";
        onSeek(f * (video?.duration || 0));
        // Hold the knob where it was dropped until the video catches up.
        requestAnimationFrame(() => (scrubbing.current = null));
      }}
      onPointerCancel={(e) => {
        scrubbing.current = null;
        e.currentTarget.dataset.scrubbing = "false";
      }}
    >
      <div className="scrubber-track">
        <div className="scrubber-buffered" ref={buffered} />
        <div className="scrubber-fill" ref={fill} />
        {span && dur > 0 && (
          <div
            className="scrubber-intro"
            title="Intro"
            style={{ left: `${(span.start / dur) * 100}%`, width: `${((span.end - span.start) / dur) * 100}%` }}
          />
        )}
        {dur > 0 &&
          chapters.map((c, i) =>
            // The first chapter starts at 0: nothing to separate.
            c.time > 0.5 && c.time < dur - 0.5 ? <div key={i} className="scrubber-chapter" style={{ left: `${(c.time / dur) * 100}%` }} /> : null,
          )}
      </div>
      <div className="scrubber-knob" ref={knob} />
      <div className="scrubber-tip" data-preview={!!previews} ref={tip}>
        {previews && (
          <div className="scrubber-preview" style={{ width: PREVIEW_W }}>
            <div className="scrubber-tile" ref={tile} />
          </div>
        )}
        <span className="scrubber-time t-caption tabular">{tipText}</span>
      </div>
    </div>
  );
}

/**
 * The cue whose frame is closest to `ms`. A cue's frame is captured at its
 * start, so past a cue's midpoint the *next* cue's frame is the nearer one.
 */
function nearestCue(cues: SeekCue[], ms: number): SeekCue | undefined {
  if (!cues.length) return undefined;
  let lo = 0;
  let hi = cues.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cues[mid].startMs <= ms) lo = mid;
    else hi = mid - 1;
  }
  const cue = cues[lo];
  const next = cues[lo + 1];
  return next && ms - cue.startMs > cue.endMs - ms ? next : cue;
}
