import { useEffect } from "react";
import { NavBar } from "./components/NavBar";
import { useRouter, type Route } from "./lib/router";
import { Home } from "./screens/Home";
import { Discover } from "./screens/Discover";
import { Library } from "./screens/Library";
import { Search } from "./screens/Search";
import { Settings } from "./screens/Settings";
import { Detail } from "./screens/Detail";
import { Player } from "./screens/Player";

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
      return <Settings />;
    case "detail":
      return <Detail type={route.type} id={route.id} preview={route.preview} />;
    case "player":
      return null; // rendered as a full-window layer below
  }
}

export function App() {
  const { stack, current, back, tab } = useRouter();
  const playing = current.name === "player" ? current : null;
  // The page under the player stays mounted so leaving playback is instant.
  const pages = stack.filter((e) => e.route.name !== "player");
  const topPage = pages[pages.length - 1];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (playing) return; // the player owns the keyboard
      const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
      if (e.key === "Escape" && !typing) back();
      if ((e.key === "k" && (e.ctrlKey || e.metaKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        tab({ name: "search" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, back, tab]);

  return (
    <div className="app">
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
      {playing && (
        // Remount per video *and* per source, so switching either starts clean.
        <Player
          key={`${playing.videoId}|${playing.stream?.content_id ?? playing.stream?.url ?? ""}`}
          type={playing.type}
          metaId={playing.metaId}
          videoId={playing.videoId}
          stream={playing.stream}
        />
      )}
    </div>
  );
}
