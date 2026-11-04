import { useEffect } from "react";
import { MotionConfig } from "motion/react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getPrefs, usePrefs } from "./lib/prefs";
import type { Settings as SettingsT } from "./lib/types";
import { NavBar } from "./components/NavBar";
import { PlayerLayer, usePlayerLayer } from "./components/PlayerLayer";
import { useSettings } from "./lib/queries";
import { uiFontOf } from "./lib/fonts";
import { rootTab, RouterProvider, useRouter, type Route } from "./lib/router";
import { focusSearch } from "./lib/searchQuery";
import { Home } from "./screens/Home";
import { Discover } from "./screens/Discover";
import { Library } from "./screens/Library";
import { Calendar } from "./screens/Calendar";
import { Search } from "./screens/Search";
import { Settings } from "./screens/Settings";
import { Detail } from "./screens/Detail";
import { Anime, AnimeBrowse, AnimeSchedule } from "./screens/Anime";
import { AnimeDetail } from "./screens/AnimeDetail";
import { AuthScreen } from "./screens/account/AuthScreen";
import { OnboardingScreen } from "./screens/account/OnboardingScreen";
import { ProfilesScreen } from "./screens/account/ProfilesScreen";
import { useAccount } from "./lib/account/AccountProvider";
import { TvApp } from "./tv/TvApp";
import { ControllerToast } from "./tv/TvChrome";
import { isTvMode, setTvMode, useTvMode } from "./tv/tvMode";
import { actionFor } from "./lib/keybinds";
import { SettingsOverlay } from "./components/SettingsOverlay";
import { CardMenuHost } from "./components/CardMenu";
import { TrailerHost } from "./components/Trailer";
import { isSettingsOpen } from "./lib/settingsOverlay";
import { UpdateToast, WhatsNewSheet } from "./components/Updates";
import { startUpdateChecks } from "./lib/updater";
import { PartyHost } from "./components/party/PartyHost";

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <Home />;
    case "discover":
      return <Discover type={route.type} />;
    case "library":
      return <Library />;
    case "calendar":
      return <Calendar />;
    case "search":
      return <Search />;
    case "settings":
      return <Settings initialPage={route.page} />;
    case "detail":
      return <Detail type={route.type} id={route.id} preview={route.preview} />;
    case "anime":
      return <Anime />;
    case "anime-detail":
      return <AnimeDetail id={route.id} preview={route.preview} />;
    case "anime-schedule":
      return <AnimeSchedule />;
    case "anime-browse":
      return <AnimeBrowse />;
    case "player":
      return null; // rendered as a full-window layer below
  }
}

/** Sign-in and profile picking come before the app itself. */
export function App() {
  const { status, profile, profilesView } = useAccount();
  const { data: settings, isFetched } = useSettings();
  switch (status) {
    case "loading":
      return <div className="account-shell" />;
    case "signed-out":
      return <AuthScreen />;
    case "onboarding":
      return <OnboardingScreen />;
    case "profiles":
      return <ProfilesScreen initial={profilesView} />;
    case "guest":
    case "ready":
      // Each profile starts on its start page with its own navigation. Wait
      // for settings (a local read) so it doesn't open on Home and then jump.
      if (!isFetched) return <div className="account-shell" />;
      return (
        <RouterProvider key={profile?.id ?? "guest"} initial={[startRoute(settings?.startPage)]}>
          <MainApp />
        </RouterProvider>
      );
  }
}

/** The desktop app or, in TV mode, the 10-foot one — over the same navigation stack. */
function MainApp() {
  const tv = useTvMode();
  const { data: settings } = useSettings();

  // On the root element so portalled menus pick it up too.
  useEffect(() => {
    document.documentElement.dataset.font = uiFontOf(settings?.uiFont);
  }, [settings?.uiFont]);

  // Settings → Appearance and → Browsing, as attributes and variables on <html>
  // (TV mode and portalled menus included).
  useEffect(() => {
    if (!settings) return;
    const root = document.documentElement;
    const accent = /^#[0-9a-f]{6}$/i.test(settings.accentColor ?? "") ? settings.accentColor : null;
    if (accent) {
      root.style.setProperty("--accent", accent);
      // Light accents (yellow, teal) need dark text on top to stay readable.
      const n = parseInt(accent.slice(1), 16);
      const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
      root.style.setProperty("--accent-fg", lum > 0.62 ? "#0b0b0b" : "#fff");
    } else {
      root.style.removeProperty("--accent");
      root.style.removeProperty("--accent-fg");
    }
    root.dataset.theme = settings.theme === "black" ? "black" : "dark";
    root.dataset.cardSize = settings.cardSize ?? "medium";
    root.dataset.reduceMotion = settings.reduceMotion ?? "system";
    root.dataset.hideThumbs = String(!!settings.hideEpisodeThumbs);
    root.dataset.hideOverviews = String(!!settings.hideEpisodeDescriptions);
  }, [settings]);

  // Interface size is this screen's, so it's a device pref.
  const { uiScale, animeEnabled } = usePrefs();

  // Anime turned off (here or on another device) while you're in it: nothing to stay on.
  const { stack, tab } = useRouter();
  const inAnime = rootTab(stack).name === "anime";
  useEffect(() => {
    if (inAnime && !animeEnabled) tab({ name: "home" });
  }, [inAnime, animeEnabled, tab]);

  useEffect(() => {
    void getCurrentWebview()
      .setZoom(uiScale > 0 ? uiScale : 1)
      .catch(() => {});
  }, [uiScale]);
  const reduce = settings?.reduceMotion;

  // Look for a new version shortly after launch, then every few hours (TV mode too).
  useEffect(() => startUpdateChecks(), []);

  // The webview's own right-click menu (Save image as, Copy image link…) has no
  // place in the app. Titles open their own options instead (CardMenu); text
  // fields and selected text keep the native one for copy and paste.
  useEffect(() => {
    const onMenu = (e: MouseEvent) => {
      if (e.defaultPrevented) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest("input, textarea, [contenteditable=''], [contenteditable='true']")) return;
      if (window.getSelection()?.toString().trim()) return;
      e.preventDefault();
    };
    document.addEventListener("contextmenu", onMenu);
    return () => document.removeEventListener("contextmenu", onMenu);
  }, []);

  // Switching modes works from anywhere, the player included (Settings → Controls to rebind).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (actionFor(e, "app") !== "toggleTv") return;
      e.preventDefault();
      setTvMode(!isTvMode());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <MotionConfig reducedMotion={reduce === "on" ? "always" : reduce === "off" ? "never" : "user"}>
      {tv ? <TvApp /> : <DesktopApp />}
      <PartyHost />
    </MotionConfig>
  );
}

/** Settings → Browsing → "Open the app on". */
function startRoute(page: SettingsT["startPage"] | undefined): Route {
  switch (page) {
    case "library":
      return { name: "library" };
    case "movies":
      return { name: "discover", type: "movie" };
    case "series":
      return { name: "discover", type: "series" };
    case "anime":
      return getPrefs().animeEnabled ? { name: "anime" } : { name: "home" };
    default:
      return { name: "home" };
  }
}

function DesktopApp() {
  const { stack, current, back } = useRouter();
  const { playing, player, leaving } = usePlayerLayer(current);
  // The page under the player stays mounted so leaving playback is instant.
  const pages = stack.filter((e) => e.route.name !== "player");
  const topPage = pages[pages.length - 1];
  const { data: settings } = useSettings();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (playing || isSettingsOpen()) return; // the player / settings overlay owns the keyboard
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "Escape" && !typing) back();
      // Modified shortcuts (Ctrl+K) work while typing too; plain keys ("/") would just type.
      if (actionFor(e, "app") === "search" && (!typing || e.ctrlKey || e.metaKey || e.altKey)) {
        e.preventDefault();
        focusSearch();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, back]);

  return (
    <div
      className="app"
      data-card-titles={settings?.showCardTitles ?? true}
      data-card-details={settings?.showCardDetails ?? true}
      data-card-ratings={settings?.showCardRatings ?? false}
      data-rating-position={settings?.cardRatingPosition ?? "poster"}
      data-rating-colors={settings?.ratingColors ?? false}
      data-player-leaving={leaving}
    >
      <main className="main">
        <NavBar />
        {pages.map((entry) => (
          <section
            key={entry.key}
            className={entry.route.name === "detail" ? "page page-pushed" : "page"}
            data-active={entry === topPage && !playing}
            aria-hidden={entry !== topPage || !!playing}
            inert={entry !== topPage || !!playing}
          >
            <Screen route={entry.route} />
          </section>
        ))}
        <ControllerToast tv={false} />
        <UpdateToast hidden={!!playing} />
      </main>
      <WhatsNewSheet />
      <PlayerLayer player={player} leaving={leaving} />
      <SettingsOverlay />
      {!playing && <CardMenuHost />}
      <TrailerHost />
    </div>
  );
}
