import logo from "../assets/polarity-white.png";
import { ChevronLeft, Close, Search, Tv } from "./icons";
import { setTvMode } from "../tv/tvMode";
import { useEffect, useRef, useState } from "react";
import { rootTab, useRouter, type TabRoute } from "../lib/router";
import { usePrefs } from "../lib/prefs";
import { useSettings } from "../lib/queries";
import { FOCUS_SEARCH_EVENT, setSearchText, useSearchText } from "../lib/searchQuery";
import { WindowControls } from "./WindowControls";
import { ProfileMenu } from "./ProfileMenu";
import { UpdatePill } from "./Updates";

const LINKS: { route: TabRoute; label: string }[] = [
  { route: { name: "home" }, label: "Home" },
  { route: { name: "discover", type: "series" }, label: "Series" },
  { route: { name: "discover", type: "movie" }, label: "Movies" },
  { route: { name: "anime" }, label: "Anime" },
  { route: { name: "library" }, label: "Library" },
];
/** Settings → Browsing → Show the Calendar (off by default). */
const CALENDAR: { route: TabRoute; label: string } = { route: { name: "calendar" }, label: "Calendar" };

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
  const { data: settings } = useSettings();
  const { animeEnabled, showTvButton } = usePrefs();
  const sections = animeEnabled ? LINKS : LINKS.filter((l) => l.route.name !== "anime");
  const links = settings?.showCalendar ? [...sections, CALENDAR] : sections;

  return (
    <header className="navbar" data-scrolled={scrolled} data-tauri-drag-region>
      <div className="navbar-fade" aria-hidden>
        <i />
        <i />
        <i />
        <i />
      </div>
      {/* Always takes its place, so the brand and tabs never shift when it appears. */}
      <button
        className="navbar-icon navbar-back pressable"
        data-shown={canGoBack}
        onClick={back}
        aria-label="Back"
        title="Back (Esc)"
        aria-hidden={!canGoBack}
        tabIndex={canGoBack ? 0 : -1}
        disabled={!canGoBack}
      >
        <ChevronLeft size={22} strokeWidth={2.25} />
      </button>
      <button className="navbar-brand" onClick={() => tab({ name: "home" })} aria-label="Polarity home">
        <img className="brand-logo" src={logo} alt="Polarity" draggable={false} />
      </button>
      <nav className="navbar-links" aria-label="Primary">
        {links.map((l) => (
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
        {showTvButton && (
          <button className="navbar-icon pressable" aria-label="TV mode" title="TV mode" onClick={() => setTvMode(true)}>
            <Tv size={23} />
          </button>
        )}
        {/* Settings lives in the profile menu, for guests too. */}
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
