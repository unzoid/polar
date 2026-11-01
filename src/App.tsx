import { useEffect, useState } from "react";
import { NavBar } from "./components/NavBar";
import { useSettings } from "./lib/queries";
import { RouterProvider, useRouter, type Route } from "./lib/router";
import { focusSearch } from "./lib/searchQuery";
import { Home } from "./screens/Home";
import { Discover } from "./screens/Discover";
import { Library } from "./screens/Library";
import { Search } from "./screens/Search";
import { Settings } from "./screens/Settings";
import { Detail } from "./screens/Detail";
import { PLAYER_EXIT_MS, Player } from "./screens/Player";
import { AuthScreen } from "./screens/account/AuthScreen";
import { ProfilesScreen } from "./screens/account/ProfilesScreen";
import { useAccount } from "./lib/account/AccountProvider";

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

function MainApp() {
  const { stack, current, back } = useRouter();
  const playing = current.name === "player" ? current : null;
  // The page under the player stays mounted so leaving playback is instant.
  const pages = stack.filter((e) => e.route.name !== "player");
  const topPage = pages[pages.length - 1];
  const { data: settings } = useSettings();

  // Keep the player drawn for its exit fade after its route is gone; the page
  // beneath is already live, so leaving never waits on the animation.
  const [shown, setShown] = useState(playing);
  useEffect(() => {
    if (playing) return setShown(playing);
    const t = window.setTimeout(() => setShown(null), PLAYER_EXIT_MS);
    return () => window.clearTimeout(t);
  }, [playing]);
  const player = playing ?? shown;
  const leaving = !playing && !!player;

  // On the root element so portalled menus pick it up too.
  useEffect(() => {
    document.documentElement.dataset.font = settings?.uiFont ?? "inter";
  }, [settings?.uiFont]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (playing) return; // the player owns the keyboard
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "Escape" && !typing) back();
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
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
      </main>
      {player && (
        // The layer fades in and out once per visit; the player inside it
        // remounts per video *and* per source, so switching either starts clean
        // without the page flashing through.
        <div className="player-layer" data-leaving={leaving} inert={leaving}>
          <Player
            key={`${player.videoId}|${player.stream?.content_id ?? player.stream?.url ?? ""}`}
            type={player.type}
            metaId={player.metaId}
            videoId={player.videoId}
            stream={player.stream}
            leaving={leaving}
          />
        </div>
      )}
    </div>
  );
}
