import { ChevronLeft, Close, Search, Settings, Tv } from "./icons";
import { openSettings } from "../lib/settingsOverlay";
import { setTvMode } from "../tv/tvMode";
import { useEffect, useRef, useState } from "react";
import { rootTab, useRouter, type TabRoute } from "../lib/router";
import { FOCUS_SEARCH_EVENT, setSearchText, useSearchText } from "../lib/searchQuery";
import { WindowControls } from "./WindowControls";
import { ProfileMenu } from "./ProfileMenu";
import { UpdatePill } from "./Updates";

const LINKS: { route: TabRoute; label: string }[] = [
  { route: { name: "home" }, label: "Home" },
  { route: { name: "discover", type: "series" }, label: "Series" },
  { route: { name: "discover", type: "movie" }, label: "Movies" },
  { route: { name: "library" }, label: "Library" },
];

const SCROLLED_AT = 8;

/**
 * Top navigation in the modern Netflix pattern, doubling as the window's
 * title bar (drag region + window controls).
 *
 * It floats transparent over hero art, and settles onto a solid material once
 * the page scrolls under it — a state change, so the background crossfades
 * via an opacity-only layer rather than repainting a gradient.
 */
export function NavBar() {
  const { stack, current, tab, back } = useRouter();
  const active = rootTab(stack);
  const isActive = (r: TabRoute) => JSON.stringify(r) === JSON.stringify(active);
  // Search results are closed by clearing the field, not with Back.
  const canGoBack = stack.length > 1 && current.name !== "search";
  const scrolled = useActivePageScrolled(stack.length);

  return (
    <header className="navbar" data-scrolled={scrolled} data-tauri-drag-region>
      <div className="navbar-bg" aria-hidden />
      {canGoBack && (
        <button className="navbar-icon navbar-back pressable" onClick={back} aria-label="Back" title="Back (Esc)">
          <ChevronLeft size={22} strokeWidth={2.25} />
        </button>
      )}
      <button className="navbar-brand" onClick={() => tab({ name: "home" })} aria-label="Polar home">
        <span>Polar</span>
      </button>
      <nav className="navbar-links" aria-label="Primary">
        {LINKS.map((l) => (
          <button
            key={l.label}
            className="navbar-link"
            aria-current={isActive(l.route) ? "page" : undefined}
            onPointerDown={(e) => e.button === 0 && tab(l.route)} // respond on press
            onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && tab(l.route)}
          >
            {l.label}
          </button>
        ))}
      </nav>
      <div className="navbar-actions">
        <UpdatePill />
        <SearchBox />
        <button className="navbar-icon pressable" aria-label="TV mode" title="TV mode" onClick={() => setTvMode(true)}>
          <Tv size={23} />
        </button>
        <button
          className="navbar-icon pressable"
          aria-label="Settings"
          title="Settings"
          aria-haspopup="dialog"
          onClick={() => openSettings()}
        >
          <Settings size={23} strokeWidth={2} />
        </button>
        <ProfileMenu />
      </div>
      <WindowControls />
    </header>
  );
}

/**
 * The search icon opens into a field right in the navbar; results only take
 * over the page once you start typing. Clearing the field goes back to where
 * you were, and leaving the results page empties it.
 */
function SearchBox() {
  const { stack, current, navigate, back } = useRouter();
  const text = useSearchText();
  const input = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const onResults = current.name === "search";
  const inStack = stack.some((e) => e.route.name === "search");
  // Text outlives the navbar (a trip through TV mode unmounts it). Still on
  // the results: come back open, without the sweep. Left them meanwhile: start fresh.
  const resume = !!text && inStack;
  const [open, setOpen] = useState(resume);
  // Opened from the keyboard (Ctrl K, "/"): appear instantly, no transition.
  const [instant, setInstant] = useState(resume);
  useEffect(() => {
    if (!resume) setSearchText("");
    // Mount only.
  }, []);

  const expand = () => {
    setInstant(false);
    setOpen(true);
    input.current?.focus();
  };

  const change = (value: string) => {
    setSearchText(value);
    if (value.trim() && !inStack) navigate({ name: "search" });
    if (!value.trim() && onResults) back();
  };

  // Left the results page some other way (a tab, Back): start fresh next time.
  const wasInStack = useRef(inStack);
  useEffect(() => {
    if (wasInStack.current && !inStack) {
      setSearchText("");
      if (document.activeElement !== input.current) setOpen(false);
    }
    wasInStack.current = inStack;
  }, [inStack]);

  // An empty field closes when you click anywhere else (blur alone misses
  // clicks that don't move focus, e.g. on the page background).
  useEffect(() => {
    if (!open || text) return;
    const onDown = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        input.current?.blur();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, [open, text]);

  useEffect(() => {
    const onFocus = () => {
      setInstant(true);
      setOpen(true);
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener(FOCUS_SEARCH_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_SEARCH_EVENT, onFocus);
  }, []);

  return (
    <div ref={box} className="navbar-search" data-open={open} data-instant={instant}>
      <button
        className="navbar-search-icon"
        aria-label="Search"
        title="Search (Ctrl K)"
        tabIndex={open ? -1 : 0}
        onClick={expand}
      >
        <Search size={23} strokeWidth={2} />
      </button>
      <input
        ref={input}
        value={text}
        onChange={(e) => change(e.target.value)}
        onBlur={() => !text && setOpen(false)}
        onKeyDown={(e) => {
          if (e.key !== "Escape") return;
          e.stopPropagation();
          if (text) change("");
          else input.current?.blur();
        }}
        placeholder="Titles, genres…"
        spellCheck={false}
        aria-label="Search"
        tabIndex={open ? 0 : -1}
      />
      {open && text && (
        <button className="navbar-search-clear" aria-label="Clear search" onMouseDown={(e) => e.preventDefault()} onClick={() => change("")}>
          <Close size={16} strokeWidth={2.25} />
        </button>
      )}
    </div>
  );
}

/**
 * Whether the visible page is scrolled. Each page owns its scroller, so listen
 * for scroll anywhere (capture) and look at the active one; re-check when the
 * page stack changes, since going back restores a page at its old position.
 */
function useActivePageScrolled(depth: number) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const check = () => {
      const el = document.querySelector<HTMLElement>('.page[data-active="true"] .scroll');
      setScrolled((el?.scrollTop ?? 0) > SCROLLED_AT);
    };
    check();
    document.addEventListener("scroll", check, { capture: true, passive: true });
    return () => document.removeEventListener("scroll", check, { capture: true });
  }, [depth]);
  return scrolled;
}
