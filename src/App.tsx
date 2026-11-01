import { useEffect } from "react";
import { NavBar } from "./components/NavBar";
import { PlayerLayer, usePlayerLayer } from "./components/PlayerLayer";
import { useSettings } from "./lib/queries";
import { RouterProvider, useRouter, type Route } from "./lib/router";
import { focusSearch } from "./lib/searchQuery";
import { Home } from "./screens/Home";
import { Discover } from "./screens/Discover";
import { Library } from "./screens/Library";
import { Search } from "./screens/Search";
import { Settings } from "./screens/Settings";
import { Detail } from "./screens/Detail";
import { AuthScreen } from "./screens/account/AuthScreen";
import { OnboardingScreen } from "./screens/account/OnboardingScreen";
import { ProfilesScreen } from "./screens/account/ProfilesScreen";
import { useAccount } from "./lib/account/AccountProvider";
import { TvApp } from "./tv/TvApp";
import { ControllerToast } from "./tv/TvChrome";
import { isTvMode, setTvMode, useTvMode } from "./tv/tvMode";
import { actionFor } from "./lib/keybinds";
import { SettingsOverlay } from "./components/SettingsOverlay";
import { isSettingsOpen } from "./lib/settingsOverlay";

function Screen({ route }: { route: Route }) {
  switch (route.name) {
    case "home":
      return <Home />;
    case "discover":
      return <Discover type={route.type} />;
    case "library":
      return <Library />;
    case "search":
      return <Search />;
    case "settings":
      return <Settings initialPage={route.page} />;
    case "detail":
      return <Detail type={route.type} id={route.id} preview={route.preview} />;
    case "player":
      return null; // rendered as a full-window layer below
  }
}

/** Sign-in and profile picking come before the app itself. */
export function App() {
  const { status, profile, profilesView } = useAccount();
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
      // Each profile starts at Home with its own navigation.
      return (
        <RouterProvider key={profile?.id ?? "guest"}>
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
    document.documentElement.dataset.font = settings?.uiFont ?? "inter";
  }, [settings?.uiFont]);

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

  return tv ? <TvApp /> : <DesktopApp />;
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
      </main>
      <PlayerLayer player={player} leaving={leaving} />
      <SettingsOverlay />
    </div>
  );
}
