import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Avatar } from "../components/Avatar";
import { Close, Desktop, Power, Profile, Search, Settings, Tv, Users, WatchParty } from "../components/icons";
import { partyAvailable, setJoinPartyOpen } from "../lib/party/party";
import { useAccount } from "../lib/account/AccountProvider";
import { rootTab, useRouter, type TabRoute } from "../lib/router";
import { usePrefs } from "../lib/prefs";
import { useSettings } from "../lib/queries";
import { buttonFor, usePadBindings, type NavAction, type PadButton, type PlayerPadAction } from "./padBindings";
import { shortcutText } from "../lib/keybinds";
import {
  dismissNotice,
  useControllerNotice,
  useGamepadConnected,
  usePadFamily,
  type Button as PadKey,
  type PadFamily,
} from "./gamepad";
import { useBack, useFocusTrap } from "./shell";
import { setTvMode } from "./tvMode";
import { Button, IconButton } from "../components/ui/Button";
import { Toast } from "../components/ui/Toast";

export const TV_TABS: { route: TabRoute; label: string }[] = [
  { route: { name: "search" }, label: "Search" },
  { route: { name: "home" }, label: "Home" },
  { route: { name: "discover", type: "series" }, label: "Series" },
  { route: { name: "discover", type: "movie" }, label: "Movies" },
  { route: { name: "anime" }, label: "Anime" },
  { route: { name: "library" }, label: "Library" },
];

export const sameTab = (a: TabRoute, b: TabRoute) => JSON.stringify(a) === JSON.stringify(b);

/** The sections as Settings has them: Anime unless it's off, the Calendar when it's on. */
export function useTvTabs() {
  const { data: settings } = useSettings();
  const { animeEnabled } = usePrefs();
  const tabs = animeEnabled ? TV_TABS : TV_TABS.filter((t) => t.route.name !== "anime");
  return settings?.showCalendar ? [...tabs, { route: { name: "calendar" } as TabRoute, label: "Calendar" }] : tabs;
}

/**
 * The top bar: you (the menu) on the left, sections in the middle, the time
 * on the right. Coming up from the page always lands on the current section.
 */
export function TvNav({ onMenu }: { onMenu: () => void }) {
  const { stack, tab } = useRouter();
  const active = rootTab(stack);
  const { profile } = useAccount();
  const tabs = useTvTabs();

  return (
    <header className="tv-nav" data-nav-keep data-nav-memory data-nav-prefer-entry data-nav-lock-x>
      <button className="tv-nav-me" onClick={onMenu} aria-label="Menu">
        {profile ? <Avatar id={profile.avatar} /> : <Tv size={28} />}
      </button>
      <nav className="tv-nav-tabs" aria-label="Sections">
        {tabs.map((t) => {
          const current = sameTab(t.route, active);
          return (
            <button
              key={t.label}
              className="tv-nav-tab"
              data-icon={t.route.name === "search" || undefined}
              aria-current={current ? "page" : undefined}
              aria-label={t.label}
              data-nav-entry={current || undefined}
              onClick={() => tab(t.route)}
            >
              {t.route.name === "search" ? <Search size={26} /> : t.label}
            </button>
          );
        })}
      </nav>
      <Clock />
    </header>
  );
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    // Tick on the minute, not every few seconds.
    let t = window.setTimeout(function tick() {
      setNow(new Date());
      t = window.setTimeout(tick, 60_000 - (Date.now() % 60_000));
    }, 60_000 - (Date.now() % 60_000));
    return () => window.clearTimeout(t);
  }, []);
  return <time className="tv-clock tabular">{timeFmt.format(now)}</time>;
}

/** The side menu: profiles, back to desktop mode, quit. */
export function TvMenu({ onClose }: { onClose: () => void }) {
  const account = useAccount();
  const { tab } = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(ref);
  useBack(true, onClose);
  const me = account.profile;
  const others = me ? account.profiles.filter((p) => p.id !== me.id) : [];
  const hasAccountItems = account.enabled && (others.length > 0 || account.status === "ready" || account.status === "guest");

  return (
    <div className="tv-menu-layer" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="tv-menu" ref={ref} data-nav-scope role="dialog" aria-label="Menu">
        {me && (
          <div className="tv-menu-me">
            <Avatar id={me.avatar} />
            <div>
              <strong>{me.name}</strong>
              {account.user?.email && <span>{account.user.email}</span>}
            </div>
          </div>
        )}
        <div className="tv-menu-list">
          {others.map((p) => (
            <button key={p.id} className="tv-menu-item" onClick={() => void account.chooseProfile(p)}>
              <Avatar id={p.avatar} />
              {p.name}
            </button>
          ))}
          {account.enabled && account.status === "ready" && (
            <button className="tv-menu-item" onClick={() => account.switchProfile("pick")}>
              <Users size={28} />
              Switch Profile
            </button>
          )}
          {account.enabled && account.status === "ready" && partyAvailable() && (
            <button
              className="tv-menu-item"
              onClick={() => {
                onClose();
                setJoinPartyOpen(true);
              }}
            >
              <WatchParty size={28} />
              Join Watch Party
            </button>
          )}
          {account.enabled && account.status === "guest" && (
            <button className="tv-menu-item" onClick={account.showSignIn}>
              <Profile size={28} />
              Sign In
            </button>
          )}
          {hasAccountItems && <div className="tv-menu-sep" />}
          <button
            className="tv-menu-item"
            onClick={() => {
              onClose();
              tab({ name: "settings" });
            }}
          >
            <Settings size={28} />
            Settings
          </button>
          <button className="tv-menu-item" onClick={() => setTvMode(false)}>
            <Desktop size={28} />
            Desktop Mode
            {shortcutText("toggleTv") && <kbd className="tv-menu-kbd">{shortcutText("toggleTv")}</kbd>}
          </button>
          <button className="tv-menu-item" onClick={() => void getCurrentWindow().close()}>
            <Power size={28} />
            Quit Polarity
          </button>
        </div>
        <button className="tv-menu-close" onClick={onClose} aria-label="Close menu" tabIndex={-1}>
          <Close size={24} />
        </button>
      </div>
    </div>
  );
}

const HINTS: { actions: NavAction[]; label: string }[] = [
  { actions: ["select"], label: "Select" },
  { actions: ["back"], label: "Back" },
  { actions: ["options"], label: "Options" },
  { actions: ["search"], label: "Search" },
  { actions: ["prevTab", "nextTab"], label: "Sections" },
  { actions: ["menu"], label: "Menu" },
];

/** What the controller's buttons do here (as Settings has them), while one is connected. */
export function TvHints() {
  const connected = useGamepadConnected();
  const { padHints } = usePrefs();
  const bindings = usePadBindings();
  if (!connected || !padHints) return null;
  return (
    <div className="tv-hints" aria-hidden>
      {HINTS.map((h) => {
        const glyphs = h.actions.map((a) => buttonFor(bindings, "nav", a)).filter((b): b is PadButton => !!b);
        // A job with no button (set to Nothing) has nothing to hint at.
        return glyphs.length === h.actions.length && <Hint key={h.label} glyphs={glyphs} label={h.label} />;
      })}
    </div>
  );
}

function Hint({ glyphs, label }: { glyphs: GlyphButton[]; label: string }) {
  return (
    <span className="tv-hint">
      {glyphs.map((g) => (
        <PadGlyph key={g} button={g} />
      ))}
      {label}
    </span>
  );
}

type GlyphButton = Exclude<PadKey, "up" | "down" | "left" | "right">;

/** PlayStation's face buttons are shapes, drawn rather than typed so they look the same everywhere. */
const shape = (d: ReactNode) => (
  <svg viewBox="0 0 16 16" width="0.95em" height="0.95em" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinejoin="round">
    {d}
  </svg>
);
const CROSS = shape(<path d="M3.5 3.5l9 9M12.5 3.5l-9 9" strokeLinecap="round" />);
const CIRCLE = shape(<circle cx="8" cy="8" r="5" />);
const SQUARE = shape(<rect x="3.25" y="3.25" width="9.5" height="9.5" rx="0.5" />);
const TRIANGLE = shape(<path d="M8 2.75l5.5 9.5h-11z" />);

/**
 * Each maker's label for the standard mapping's buttons, by position: the
 * bottom face button is A on Xbox, ✕ on PlayStation and B on Nintendo.
 */
const LABELS: Record<PadFamily, Record<GlyphButton, ReactNode>> = {
  xbox: { a: "A", b: "B", x: "X", y: "Y", lb: "LB", rb: "RB", view: "View", menu: "☰" },
  playstation: { a: CROSS, b: CIRCLE, x: SQUARE, y: TRIANGLE, lb: "L1", rb: "R1", view: "Create", menu: "☰" },
  nintendo: { a: "B", b: "A", x: "Y", y: "X", lb: "L", rb: "R", view: "−", menu: "+" },
};

/** A controller button's label in the connected controller's own terms (A / ✕, LB / L1…). */
export function PadGlyph({ button }: { button: GlyphButton }) {
  const label = LABELS[usePadFamily()][button];
  return (
    <span className="pad-glyph" data-wide={(typeof label === "string" && label.length > 1) || undefined} aria-hidden>
      {label}
    </span>
  );
}

/**
 * The controller button for a player control (whichever is bound to the
 * first of `actions` that has one), while TV mode has a controller connected.
 */
export function usePadGlyph(tv: boolean) {
  const connected = useGamepadConnected();
  const bindings = usePadBindings();
  return (...actions: PlayerPadAction[]) => {
    const button = tv && connected ? buttonFor(bindings, "player", ...actions) : undefined;
    return button ? <PadGlyph button={button} /> : null;
  };
}

/**
 * A controller coming or going gets a notice, in either mode. The OS reports
 * a controller as soon as it's plugged in or switched on, but the app can
 * only use it after a button press, so the notice says so until then. In
 * desktop mode it also offers TV mode (Menu switches straight over).
 */
export function ControllerToast({ tv }: { tv: boolean }) {
  const notice = useControllerNotice();
  const prefs = usePrefs();
  const offerTv = !tv && notice?.kind === "connected" && prefs.suggestTvMode;
  const show = !!notice && (prefs.controllerAlerts || offerTv);
  const awaiting = !!notice?.awaitingPress;

  useEffect(() => {
    if (!show || !notice) return;
    const ms = offerTv ? 10_000 : awaiting ? 12_000 : notice.kind === "connected" ? 4500 : 3500;
    const t = window.setTimeout(dismissNotice, ms);
    return () => window.clearTimeout(t);
  }, [show, notice, offerTv, awaiting]);

  if (!show || !notice) return null;
  const connected = notice.kind === "connected";
  return (
    <Toast
      key={notice.key}
      variant={tv ? "tv" : undefined}
      data-kind={notice.kind}
      icon={<GamepadIcon off={!connected} />}
      actions={
        <>
          {offerTv && (
            <Button variant="primary" className="toast-action" onClick={() => setTvMode(true)}>
              Open TV Mode
            </Button>
          )}
          {!tv && (
            <IconButton label="Dismiss" onClick={dismissNotice}>
              <Close size={18} />
            </IconButton>
          )}
        </>
      }
    >
      <strong>
        {notice.name} {connected ? "connected" : "disconnected"}
      </strong>
      {connected && awaiting && <span>Press any button to start using it.</span>}
      {offerTv && !awaiting && (
        <span>
          Press <PadGlyph button="menu" /> for TV mode.
        </span>
      )}
    </Toast>
  );
}

function GamepadIcon({ off }: { off?: boolean }) {
  return (
    <svg className="toast-icon" viewBox="0 0 24 24" width={24} height={24} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7.5 7h9a4.5 4.5 0 0 1 4.4 3.6l.9 4.6a2.6 2.6 0 0 1-4.6 2.1L15.5 15h-7l-1.7 2.3a2.6 2.6 0 0 1-4.6-2.1l.9-4.6A4.5 4.5 0 0 1 7.5 7Z" />
      <path d="M8 9.5v3M6.5 11h3" />
      <circle cx="15.5" cy="10.25" r="0.6" fill="currentColor" />
      <circle cx="17" cy="12" r="0.6" fill="currentColor" />
      {off && <path d="M4 4l16 16" />}
    </svg>
  );
}
