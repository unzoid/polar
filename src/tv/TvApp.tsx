import { useCallback, useEffect, useRef, useState } from "react";
import { PlayerLayer, usePlayerLayer } from "../components/PlayerLayer";
import { rootTab, useRouter, type Route } from "../lib/router";
import { TV_ACTION_EVENT, type TvAction } from "./gamepad";
import { PageActive } from "./shell";
import {
  activeScope,
  focusEl,
  focusWhenReady,
  installFocusMemory,
  installPointerFocus,
  KEY_DIRS,
  landingIn,
  move,
  ownsArrows,
} from "./spatial";
import { dismissDepth, dismissTop, onDismissed, pressEscape, useSystemBack } from "../lib/ui";
import { leaveApp } from "../lib/platform";
import { Desktop } from "../components/icons";
import { actionFor, shortcutText } from "../lib/settings";
import { playSound } from "./sounds";
import { markHeldMove } from "./held";
import { useSettings } from "../lib/net";
import { setTvMode } from "./tvMode";
import { ControllerToast, TvHints, TvMenu, TvNav, sameTab, useTvTabs } from "./TvChrome";
import { TvCardMenuHost, useCardMenuOpen } from "./TvCardMenu";
import { TvAnime, TvAnimeDetail } from "./TvAnime";
import { TvDetail } from "./TvDetail";
import { TvCalendar, TvDiscover, TvHome, TvLibrary, TvSearch } from "./TvScreens";
import { TvSettings } from "./TvSettings";
import { TvJoinParty } from "./TvJoinParty";
import { useJoinPartyOpen } from "../lib/party";
import { ErrorBoundary } from "../components/ui/ErrorBoundary";
import { StoreProblemToast } from "../components/StoreProblemToast";
import { AccountFullToast } from "../components/AccountFullToast";

function TvScreen({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <TvHome />;
    case "discover":
      return <TvDiscover type={route.type} />;
    case "library":
    // Collections and playlists are desktop pages; switching modes on one lands here.
    case "library-collection":
    case "playlist":
      return <TvLibrary />;
    case "calendar":
      return <TvCalendar />;
    case "search":
      return <TvSearch />;
    case "settings":
      return <TvSettings page={route.page} />;
    case "detail":
      return <TvDetail type={route.type} id={route.id} preview={route.preview} />;
    case "player":
      return null; // the player layer
    case "anime":
    // Schedule and Browse are desktop pages; switching modes on one lands here.
    case "anime-schedule":
    case "anime-browse":
      return <TvAnime />;
    case "anime-detail":
      return <TvAnimeDetail id={route.id} />;
  }
}

/** The cursor gets out of the way: hidden while you use keys or a controller, back when the mouse moves. */
const CURSOR_IDLE_MS = 2500;

/**
 * TV mode's shell: the same navigation stack and player as desktop mode, with
 * a 10-foot interface on top — everything reachable with arrows, Enter and
 * Back (or a controller), focus that remembers where you were, and Back that
 * walks out one layer at a time: panel → page → Home → the menu.
 */
export function TvApp() {
  const { stack, current, back, tab } = useRouter();
  const { playing, player, leaving } = usePlayerLayer(current);
  const pages = stack.filter((e) => e.route.name !== "player");
  const topPage = pages[pages.length - 1];
  const atRoot = pages.length === 1;
  const activeTab = rootTab(stack);
  const [menuOpen, setMenuOpen] = useState(false);
  const cardMenuOpen = useCardMenuOpen();
  const [cursorHidden, setCursorHidden] = useState(true);
  const pageEls = useRef(new Map<number, HTMLElement>());
  const { data: settings } = useSettings();
  const tabs = useTvTabs();
  const joinPartyOpen = useJoinPartyOpen();

  useEffect(installFocusMemory, []);
  useEffect(installPointerFocus, []);
  // A remote's Back on Android TV is the system Back: the same as Escape here, except that Back with only the
  // menu open on Home leaves the app (Back on Home opens the menu, so the second Back leaves, as TV apps do).
  useSystemBack(() => {
    const onlyMenu = menuOpen && dismissDepth() === 1 && !playing && stack.length === 1 && activeTab.name === "home";
    if (onlyMenu) void leaveApp();
    else pressEscape();
  });

  // The pack's startup chime (if it has one) as TV mode opens, once the first frame is up.
  useEffect(() => {
    const t = setTimeout(() => playSound("startup"), 300);
    return () => clearTimeout(t);
  }, []);

  const goBack = useCallback(() => {
    if (stack.length > 1) return back();
    if (activeTab.name !== "home") return tab({ name: "home" });
    setMenuOpen(true);
  }, [stack.length, back, tab, activeTab]);

  // Arrows move focus; Esc / Backspace / B go back. The player owns the keyboard while it's up.
  useEffect(() => {
    if (playing) return;
    // An open panel, menu or sheet closes first: Escape does that before it gets here, the other keys below.
    const offDismissed = onDismissed(() => playSound("back"));
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return;
      const dir = KEY_DIRS[e.key];
      if (dir) {
        if (ownsArrows(e.target)) return;
        e.preventDefault(); // never let the browser scroll on its own
        if (e.repeat) markHeldMove();
        playSound(move(dir) ? "move" : "edge");
        return;
      }
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "Enter" && !typing && e.target !== document.body) {
        playSound("select");
        return;
      }
      if (e.key === "Escape" || e.key === "GoBack" || e.key === "BrowserBack" || (e.key === "Backspace" && !typing)) {
        e.preventDefault();
        if (dismissTop()) return;
        playSound("back");
        goBack();
        return;
      }
      if (!typing && actionFor(e, "app") === "search") {
        e.preventDefault();
        tab({ name: "search" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      offDismissed();
      window.removeEventListener("keydown", onKey);
    };
  }, [playing, goBack, tab]);

  // Controller-only shortcuts: shoulders switch sections, Y searches, Menu opens the menu.
  useEffect(() => {
    // A title's options menu has the controller until it closes.
    if (playing || cardMenuOpen) return;
    const onAction = (e: Event) => {
      const action = (e as CustomEvent<TvAction>).detail;
      if (action === "menu") {
        playSound(menuOpen ? "back" : "select");
        return setMenuOpen((o) => !o);
      }
      if (menuOpen) return;
      playSound("move");
      if (action === "search") return tab({ name: "search" });
      const i = tabs.findIndex((t) => sameTab(t.route, activeTab));
      const j = Math.min(tabs.length - 1, Math.max(0, i + (action === "nextTab" ? 1 : -1)));
      if (j !== i) tab(tabs[j].route);
    };
    window.addEventListener(TV_ACTION_EVENT, onAction);
    return () => window.removeEventListener(TV_ACTION_EVENT, onAction);
  }, [playing, menuOpen, cardMenuOpen, tab, activeTab, tabs]);

  // Arriving on a page (or back from the player) puts focus where you were on it, or its first title.
  useEffect(() => {
    if (playing || menuOpen) return;
    return focusWhenReady(pageEls.current.get(topPage.key) ?? null, { respectKeep: true });
  }, [topPage.key, playing, menuOpen]);

  // Focus must never fall off the screen (a card that went away, a click on
  // the background): put it back somewhere sensible.
  const playingRef = useRef(!!playing);
  playingRef.current = !!playing;
  useEffect(() => {
    const onFocusOut = (e: FocusEvent) => {
      if (e.relatedTarget) return;
      requestAnimationFrame(() => {
        if (playingRef.current || (document.activeElement && document.activeElement !== document.body)) return;
        const scope = activeScope();
        const target = scope && landingIn(scope);
        if (target) focusEl(target, false);
      });
    };
    document.addEventListener("focusout", onFocusOut);
    return () => document.removeEventListener("focusout", onFocusOut);
  }, []);

  useEffect(() => {
    let t = 0;
    const onMove = () => {
      setCursorHidden(false);
      window.clearTimeout(t);
      t = window.setTimeout(() => setCursorHidden(true), CURSOR_IDLE_MS);
    };
    const onKey = () => setCursorHidden(true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div
      className="app tv"
      data-player-leaving={leaving}
      data-cursor={cursorHidden ? "hidden" : "shown"}
      data-card-ratings={settings?.showCardRatings ?? false}
      data-rating-position={settings?.cardRatingPosition ?? "poster"}
      data-rating-colors={settings?.ratingColors ?? false}
    >
      <main className="main tv-main" data-nav-scope>
        {pages.map((entry) => {
          const isTop = entry === topPage;
          return (
            <section
              key={entry.key}
              ref={(el) => {
                if (el) pageEls.current.set(entry.key, el);
                else pageEls.current.delete(entry.key);
              }}
              className={entry.route.name === "detail" ? "tv-page tv-page-pushed" : "tv-page"}
              data-nav-memory
              data-nav-home={(isTop && !playing) || undefined}
              data-active={isTop && !playing}
              data-under-player={(isTop && !!player) || undefined}
              inert={!isTop || !!playing}
            >
              <PageActive.Provider value={isTop && !playing && !menuOpen && !cardMenuOpen}>
                <ErrorBoundary where={`tv page ${entry.route.name}`} variant="tv">
                  <TvScreen route={entry.route} />
                </ErrorBoundary>
              </PageActive.Provider>
            </section>
          );
        })}
        {/* Sections are for the top level; a title page is a place of its own. */}
        {atRoot && <TvNav onMenu={() => setMenuOpen(true)} />}
        {!playing && <TvCardMenuHost />}
        {menuOpen && <TvMenu onClose={() => setMenuOpen(false)} />}
        {joinPartyOpen && !playing && <TvJoinParty />}
        <TvHints />
        {!playing && (
          <button className="tv-exit" tabIndex={-1} onClick={() => setTvMode(false)}>
            <Desktop size={20} />
            Exit TV Mode
            {shortcutText("toggleTv") && <kbd>{shortcutText("toggleTv")}</kbd>}
          </button>
        )}
        <ControllerToast tv />
        <StoreProblemToast tv />
        <AccountFullToast tv />
      </main>
      <PlayerLayer player={player} leaving={leaving} />
    </div>
  );
}
