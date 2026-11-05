import logo from "../assets/polarity-white.png";
import { ChevronDown, ChevronLeft, Close, Search, Speed, Tv } from "./icons";
import { addRecentSearch, clearRecentSearches, FOCUS_SEARCH_EVENT, setSearchText, useRecentSearches, useSearchText } from "../lib/catalog";
import { setTvMode } from "../tv/tvMode";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { rootTab, useRouter, type TabRoute } from "../lib/router";
import { usePrefs } from "../lib/settings";
import { MOD_LABEL } from "../lib/platform";
import { useSettings } from "../lib/net";
import { WindowControls } from "./WindowControls";
import { ProfileMenu } from "./ProfileMenu";
import { UpdatePill } from "./Updates";
import { useParty } from "../lib/party";
import { PartyBadge } from "./party/PartyUI";
import { Chip } from "./ui/Chip";
import { MenuItem, MenuPopup, MenuRoot, MenuTrigger } from "./ui/Menu";

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
      <NavLinks links={links} isActive={isActive} open={tab} />
      <div className="navbar-actions">
        <UpdatePill />
        <NavParty />
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

/** Still in a watch party while browsing: who's in it, and the way back to what the room is watching. */
function NavParty() {
  const party = useParty();
  const { navigate } = useRouter();
  const m = party?.playback?.media;
  if (!party || !m) return null;
  return <PartyBadge party={party} onOpen={() => navigate({ name: "player", type: m.type, metaId: m.metaId, videoId: m.videoId })} />;
}

/**
 * The tabs, as many as fit; the rest go in a "More" menu at the end, so a
 * narrow window never cuts one in half. Every tab stays rendered (the
 * overflowing ones invisible) so their widths can be measured.
 */
function NavLinks({ links, isActive, open }: { links: typeof LINKS; isActive: (r: TabRoute) => boolean; open: (r: TabRoute) => void }) {
  const nav = useRef<HTMLElement>(null);
  const more = useRef<HTMLButtonElement>(null);
  const [fit, setFit] = useState(links.length);

  useLayoutEffect(() => {
    const el = nav.current;
    if (!el) return;
    const measure = () => {
      const tabs = [...el.querySelectorAll<HTMLElement>(":scope > .navbar-link:not(.navbar-more)")];
      const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
      const widths = tabs.map((t) => t.offsetWidth + gap);
      const room = el.clientWidth;
      if (widths.reduce((a, b) => a + b, 0) - gap <= room) return setFit(tabs.length);
      let used = (more.current?.offsetWidth ?? 90) + gap;
      let n = 0;
      while (n < widths.length && used + widths[n] <= room) used += widths[n++];
      setFit(n);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [links]);

  const rest = links.slice(fit);
  return (
    <nav ref={nav} className="navbar-links" aria-label="Primary" data-tauri-drag-region>
      {links.map((l, i) => (
        <button
          key={l.label}
          className="navbar-link"
          data-overflow={i >= fit || undefined}
          aria-hidden={i >= fit || undefined}
          tabIndex={i >= fit ? -1 : undefined}
          aria-current={isActive(l.route) ? "page" : undefined}
          onPointerDown={(e) => e.button === 0 && open(l.route)} // respond on press
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && open(l.route)}
        >
          {l.label}
        </button>
      ))}
      <MenuRoot modal={false}>
        <MenuTrigger
          ref={more}
          className="navbar-link navbar-more"
          data-overflow={rest.length ? undefined : true}
          aria-current={rest.some((l) => isActive(l.route)) ? "page" : undefined}
        >
          {rest.find((l) => isActive(l.route))?.label ?? "More"}
          <ChevronDown size={14} />
        </MenuTrigger>
        <MenuPopup look="roomy" sideOffset={8} align="start">
          {rest.map((l) => (
            <MenuItem key={l.label} onClick={() => open(l.route)}>
              {l.label}
            </MenuItem>
          ))}
        </MenuPopup>
      </MenuRoot>
    </nav>
  );
}

/**
 * The search icon opens into a field right in the navbar; results only take
 * over the page once you start typing. Clearing the field goes back to where
 * you were, and leaving the results page empties it.
 */
function SearchBox() {
  const { stack, current, navigate, back, tab } = useRouter();
  const text = useSearchText();
  const { searchSuggestions } = usePrefs();
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
    if (resume) return;
    setSearchText("");
    // Arrived on an empty results page (TV mode's search keeps its own text): leave it.
    if (onResults) {
      if (stack.length > 1) back();
      else tab({ name: "home" });
    }
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (!box.current?.contains(e.target as Node) && !(e.target as Element).closest?.(".search-suggest")) {
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
        title={`Search (${MOD_LABEL} K)`}
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
          if (e.key === "Enter") return addRecentSearch(text);
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
      {open && !text && searchSuggestions && <SearchSuggestions pick={change} under={box.current} />}
      {open && text && (
        <button className="navbar-search-clear" aria-label="Clear search" onMouseDown={(e) => e.preventDefault()} onClick={() => change("")}>
          <Close size={16} strokeWidth={2.25} />
        </button>
      )}
    </div>
  );
}

/** A handful to start from; every genre is in Movies, Series and Anime → Browse. */
const SUGGESTED_GENRES = ["Action", "Comedy", "Drama", "Horror", "Sci-Fi", "Thriller", "Romance", "Documentary"];
const SUGGESTED_ANIME = ["Isekai", "Shounen", "Slice of Life", "Mecha", "Iyashikei", "Psychological"];

/** The recent searches shown above the genres. */
const RECENT_SHOWN = 3;

/** Under the empty field: your last searches, then genres to search by, one click from their titles. */
function SearchSuggestions({ pick, under }: { pick: (text: string) => void; under: HTMLElement | null }) {
  const { animeEnabled } = usePrefs();
  const recent = useRecentSearches().slice(0, RECENT_SHOWN);
  if (!under) return null;
  // The field clips everything inside it (its open/close sweep), so this sits on the body.
  const r = under.getBoundingClientRect();
  const chips = (list: string[]) =>
    list.map((g) => (
      <Chip key={g} tabIndex={-1} onClick={() => pick(g)}>
        {g}
      </Chip>
    ));
  return createPortal(
    // Keeps focus in the field, so it doesn't blur (and close) on the way.
    <div
      className="search-suggest"
      style={{ top: r.bottom + 8, right: window.innerWidth - r.right }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {recent.length > 0 && (
        <>
          <div className="search-suggest-head">
            <span className="search-suggest-title">Recent</span>
            <button className="search-suggest-clear" tabIndex={-1} onClick={clearRecentSearches}>
              Clear
            </button>
          </div>
          <div className="search-recent">
            {recent.map((r) => (
              <button key={r} className="search-recent-item" tabIndex={-1} onClick={() => pick(r)}>
                <Speed size={16} aria-hidden />
                <span>{r}</span>
              </button>
            ))}
          </div>
        </>
      )}
      <span className="search-suggest-title">Genres</span>
      <div className="genre-wrap">{chips(SUGGESTED_GENRES)}</div>
      {animeEnabled && (
        <>
          <span className="search-suggest-title">Anime</span>
          <div className="genre-wrap">{chips(SUGGESTED_ANIME)}</div>
        </>
      )}
    </div>,
    document.body,
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
