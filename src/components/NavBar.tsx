import { ChevronLeft, Search, Settings } from "lucide-react";
import { useEffect, useState } from "react";
import { rootTab, useRouter, type TabRoute } from "../lib/router";
import { WindowControls } from "./WindowControls";

const LINKS: { route: TabRoute; label: string }[] = [
  { route: { name: "home" }, label: "Home" },
  { route: { name: "discover", type: "series" }, label: "Series" },
  { route: { name: "discover", type: "movie" }, label: "Movies" },
  { route: { name: "library" }, label: "My List" },
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
  const { stack, tab, back } = useRouter();
  const active = rootTab(stack);
  const isActive = (r: TabRoute) => JSON.stringify(r) === JSON.stringify(active);
  const canGoBack = stack.length > 1;
  const scrolled = useActivePageScrolled(stack.length);

  return (
    <header className="navbar" data-scrolled={scrolled} data-tauri-drag-region>
      <div className="navbar-bg" aria-hidden />
      {canGoBack && (
        <button className="navbar-icon navbar-back pressable" onClick={back} aria-label="Back" title="Back (Esc)">
          <ChevronLeft size={22} strokeWidth={2.25} />
        </button>
      )}
      <button className="navbar-brand" onClick={() => tab({ name: "home" })} aria-label="Rustio home">
        <img src="/app-icon.svg" alt="" width={24} height={24} />
        <span>Rustio</span>
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
        <button
          className="navbar-icon pressable"
          aria-label="Search"
          title="Search (Ctrl K)"
          aria-current={active.name === "search" ? "page" : undefined}
          onClick={() => tab({ name: "search" })}
        >
          <Search size={20} strokeWidth={2.1} />
        </button>
        <button
          className="navbar-icon pressable"
          aria-label="Settings"
          title="Settings"
          aria-current={active.name === "settings" ? "page" : undefined}
          onClick={() => tab({ name: "settings" })}
        >
          <Settings size={20} strokeWidth={2.1} />
        </button>
      </div>
      <WindowControls />
    </header>
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
