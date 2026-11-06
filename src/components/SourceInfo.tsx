import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { createPortal } from "react-dom";
import { Info, Play } from "./icons";
import { Button } from "./ui/Button";
import { useLayer } from "../lib/ui";
import { sourceInfo, sourceInfoText, type InfoSection, type SourceInfoContext } from "../lib/playback";
import type { RankedStream } from "../lib/types";
import { glideScroll, glideTarget } from "../tv/follow";
import { focusWhenReady } from "../tv/spatial";
import { useBack } from "../tv/shell";
import { playSound } from "../tv/sounds";
import { isMenuKey } from "../tv/menuKey";

/**
 * A source's "i" panel (#229): everything the source carries, masked
 * (lib/playback/sourceInfo.ts), with a Copy button where there's a clipboard.
 * On desktop and phones a card over the page; on TV a full-screen panel that
 * the D-pad scrolls, reached from the row's menu (TvSourceMenu).
 */

/** Only where the platform has a clipboard: elsewhere the panel is the whole answer. */
const canCopy = () => typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function";

export interface SourceInfoRequest {
  title: string;
  sections: InfoSection[];
  /** Where focus goes back to on close (the row). */
  returnTo?: HTMLElement | null;
}

/** One panel at a time per list: `show` opens it for a source, `panel` is what to render. */
export function useSourceInfo(tv = false) {
  const [request, setRequest] = useState<SourceInfoRequest | null>(null);
  const show = (r: RankedStream, title: string, ctx: SourceInfoContext, returnTo?: HTMLElement | null) =>
    setRequest({ title, sections: sourceInfo(r, ctx), returnTo });
  const close = () => {
    const back = request?.returnTo;
    setRequest(null);
    // The row it was opened from, even when a menu stood in between.
    if (back) requestAnimationFrame(() => back.isConnected && back.focus({ preventScroll: true }));
  };
  const panel = request ? <SourceInfoPanel key={request.title} request={request} onClose={close} tv={tv} /> : null;
  return { show, close, open: !!request, panel };
}

function CopyButton({ text, tv }: { text: string; tv?: boolean }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <Button
      variant="glass"
      className={tv ? "tv-pill" : undefined}
      onClick={() => void navigator.clipboard.writeText(text).then(() => setCopied(true), () => setCopied(false))}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

function Sections({ sections }: { sections: InfoSection[] }) {
  return (
    <>
      {sections.map((s) => (
        <section key={s.title} className="source-info-section">
          <h3 className="source-info-heading">{s.title}</h3>
          <dl>
            {s.rows.map((r, i) => (
              <div key={`${r.label}-${i}`} className="source-info-row">
                <dt>{r.label}</dt>
                <dd>{r.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </>
  );
}

export function SourceInfoPanel({ request, onClose, tv }: { request: SourceInfoRequest; onClose: () => void; tv?: boolean }) {
  return tv ? <TvPanel request={request} onClose={onClose} /> : <DesktopPanel request={request} onClose={onClose} />;
}

function DesktopPanel({ request, onClose }: { request: SourceInfoRequest; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useLayer(root, true, onClose);
  // Over everything, whatever opened it: a sheet's transform would otherwise hold it inside the sheet.
  return createPortal(
    <div
      className="source-info"
      role="dialog"
      aria-modal="true"
      aria-labelledby="source-info-title"
      ref={root}
      tabIndex={-1}
      data-layer
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="source-info-card">
        <header>
          <h2 id="source-info-title" className="t-title2">
            Source Info
          </h2>
          <p className="t-caption muted">{request.title}</p>
        </header>
        <div className="source-info-body" data-testid="source-info-body">
          <Sections sections={request.sections} />
        </div>
        <div className="source-info-actions">
          {canCopy() && <CopyButton text={sourceInfoText(request.sections)} />}
          <Button variant="primary" onClick={onClose} autoFocus>
            Done
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/** Where TV layers go: over everything, the player included; the last D-pad scope in the page is the one in use. */
const tvHost = () => document.body;

function TvPanel({ request, onClose }: { request: SourceInfoRequest; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useBack(true, () => {
    playSound("back");
    onClose();
  });
  useEffect(() => focusWhenReady(ref.current), []);
  return createPortal(
    <div className="tv-panel tv-sources tv-source-info source-info" ref={ref} data-nav-scope role="dialog" aria-label="Source Info">
      <header className="tv-sources-head">
        <h2 className="tv-heading">Source Info</h2>
        <p className="tv-sources-sub">{request.title}</p>
      </header>
      {/* Focusable, so the arrows scroll it: there's nothing to press in it. */}
      <div
        className="tv-scroll tv-sources-list source-info-body"
        data-testid="source-info-body"
        data-nav-scroll
        tabIndex={0}
        data-nav-default
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          const el = e.currentTarget;
          const down = e.key === "ArrowDown";
          // The keys are handled here, not by the D-pad's focus moves: the player has none of its own.
          e.preventDefault();
          e.stopPropagation();
          if (e.target !== el) return void (down || el.focus({ preventScroll: true }));
          // At the end, down reaches Copy (where there is one).
          if (down ? el.scrollTop + el.clientHeight >= el.scrollHeight - 4 : el.scrollTop <= 0) {
            if (down) el.querySelector<HTMLElement>(".source-info-actions button")?.focus();
            return;
          }
          glideScroll(el, "y", (glideTarget(el, "y") ?? el.scrollTop) + (down ? 1 : -1) * el.clientHeight * 0.4);
        }}
      >
        <Sections sections={request.sections} />
        {canCopy() && (
          <div className="source-info-actions">
            <CopyButton text={sourceInfoText(request.sections)} tv />
          </div>
        )}
      </div>
    </div>,
    tvHost(),
  );
}

const EDGE = 24;
const GAP = 16;

/**
 * A TV source row's menu: Info first, then Play. Opened by holding OK on the
 * row or with the controller's options button; Back closes it onto the row.
 */
export function TvSourceMenu({ anchor, onInfo, onPlay, onClose }: { anchor: HTMLElement; onInfo: () => void; onPlay: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useBack(true, () => {
    playSound("back");
    onClose();
  });
  useEffect(() => {
    playSound("select");
    return focusWhenReady(ref.current);
  }, []);
  // Under the row, or above it when there's no room below.
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const box = tvHost().getBoundingClientRect();
    const row = anchor.getBoundingClientRect();
    const below = row.bottom - box.top + GAP;
    const top = below + menu.offsetHeight <= box.height - EDGE ? below : row.top - box.top - GAP - menu.offsetHeight;
    setPlace({ left: Math.max(EDGE, Math.min(row.left - box.left, box.width - menu.offsetWidth - EDGE)), top: Math.max(EDGE, top) });
  }, [anchor]);
  return createPortal(
    <div className="tv-card-menu-layer tv-source-menu-layer" data-dim onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        ref={ref}
        className="tv-card-menu tv-source-menu"
        data-nav-scope
        role="menu"
        aria-label="Source options"
        // OK still held after it opened the menu repeats: that's not a press of Info.
        onKeyDownCapture={(e) => e.key === "Enter" && e.repeat && e.preventDefault()}
        // Up and down between its items, here as over the player (which has no D-pad moves of its own).
        onKeyDown={(e) => {
          if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
          e.preventDefault();
          e.stopPropagation();
          const items = [...e.currentTarget.querySelectorAll<HTMLElement>(".tv-card-menu-item")];
          const i = items.indexOf(document.activeElement as HTMLElement);
          items[Math.max(0, Math.min(items.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))]?.focus();
        }}
        style={place ? { left: place.left, top: place.top } : { visibility: "hidden" }}
      >
        <div className="tv-card-menu-group">
          <button className="tv-card-menu-item" role="menuitem" data-nav-default onClick={onInfo}>
            <span>Info</span>
            <Info size={24} />
          </button>
          <button className="tv-card-menu-item" role="menuitem" onClick={onPlay}>
            <span>Play This Source</span>
            <Play size={24} />
          </button>
        </div>
      </div>
    </div>,
    tvHost(),
  );
}

/** How long OK is held on a TV source row before it opens the row's menu instead of playing (ms). */
const HOLD_OK_MS = 500;

/**
 * The ways a source row opens its info, as props for the row's button: a long
 * press (phones, tablets) or a right-click opens the panel; on TV (`onMenu`)
 * the row's menu opens instead, from the options button or OK held down. A
 * short OK still plays when it comes up; a controller's A (an Enter with no
 * key-up, tv/gamepad.ts) plays as before.
 */
export function useSourceRowPress({ onPick, onInfo, onMenu }: { onPick: () => void; onInfo: (anchor: HTMLElement) => void; onMenu?: (anchor: HTMLElement) => void }) {
  const hold = useRef<{ timer: number; fired: boolean } | null>(null);
  const stop = () => {
    if (hold.current) window.clearTimeout(hold.current.timer);
    hold.current = null;
  };
  useEffect(() => stop, []);
  return {
    onContextMenu: (e: MouseEvent<HTMLElement>) => {
      e.preventDefault();
      e.stopPropagation();
      if (onMenu) onMenu(e.currentTarget);
      else onInfo(e.currentTarget);
    },
    onKeyDown: onMenu
      ? (e: KeyboardEvent<HTMLElement>) => {
          const el = e.currentTarget;
          if (isMenuKey(e)) {
            e.preventDefault();
            e.stopPropagation();
            onMenu(el);
            return;
          }
          if (e.key !== "Enter" || !e.isTrusted) return;
          e.preventDefault();
          e.stopPropagation();
          if (e.repeat || hold.current) return;
          const h = { fired: false, timer: 0 };
          h.timer = window.setTimeout(() => {
            h.fired = true;
            onMenu(el);
          }, HOLD_OK_MS);
          hold.current = h;
        }
      : undefined,
    onKeyUp: onMenu
      ? (e: KeyboardEvent<HTMLElement>) => {
          const h = hold.current;
          if (e.key !== "Enter" || !h) return;
          stop();
          if (!h.fired) onPick();
        }
      : undefined,
    onBlur: stop,
  };
}
