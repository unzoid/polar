import { MarketplacePage } from "../components/Marketplace";
import { useState } from "react";
import { useAccount } from "../lib/account/AccountProvider";
import { PAGES } from "../components/settings/pages";
import type { PageId } from "../lib/settings/pages";
import { AboutPage } from "./settings/AboutPage";
import { AccountPage } from "./settings/AccountPage";
import { AddonsPage } from "./settings/AddonsPage";
import { AdvancedPage } from "./settings/AdvancedPage";
import { AnimePage } from "./settings/AnimePage";
import { AppearancePage } from "./settings/AppearancePage";
import { BrowsingPage } from "./settings/BrowsingPage";
import { ControllerPage } from "./settings/ControllerPage";
import { ControlsPage } from "./settings/ControlsPage";
import { PlaybackPage } from "./settings/PlaybackPage";
import { ServicesPage } from "./settings/ServicesPage";
import { SourcesPage } from "./settings/SourcesPage";
import { SubtitlesPage } from "./settings/SubtitlesPage";

/**
 * Sections in a sidebar, one page at a time on the right, options grouped
 * into cards. Everything saves the moment it changes, except typed values
 * (keys, addresses), which save on their own button.
 */
export function Settings({ initialPage }: { initialPage?: string }) {
  const { enabled: accounts } = useAccount();
  const pages = accounts ? PAGES : PAGES.filter((p) => p.id !== "account");
  const [page, setPage] = useState<PageId>(() =>
    pages.some((p) => p.id === initialPage) ? (initialPage as PageId) : pages[0].id,
  );
  const current = pages.find((p) => p.id === page) ?? pages[0];

  return (
    <div className="scroll">
      <div className="settings">
        <nav className="settings-nav" aria-label="Settings sections">
          {pages.map((p) => (
            <button
              key={p.id}
              className="settings-nav-item"
              aria-current={p.id === page ? "page" : undefined}
              onClick={() => setPage(p.id)}
            >
              <p.icon size={20} strokeWidth={p.id === page ? 2.4 : 2} />
              {p.label}
            </button>
          ))}
        </nav>

        <div className="settings-main" key={page}>
          <header className="settings-head">
            <h1 className="settings-title">{current.label}</h1>
          </header>
          <SettingsPageBody page={page} />
        </div>
      </div>
    </div>
  );
}

/** One page's content on its own, for the settings overlay. */
export function SettingsPageBody({ page }: { page: PageId }) {
  switch (page) {
    case "account":
      return <AccountPage />;
    case "playback":
      return <PlaybackPage />;
    case "sources":
      return <SourcesPage />;
    case "subtitles":
      return <SubtitlesPage />;
    case "appearance":
      return <AppearancePage />;
    case "browsing":
      return <BrowsingPage />;
    case "anime":
      return <AnimePage />;
    case "advanced":
      return <AdvancedPage />;
    case "controls":
      return <ControlsPage />;
    case "controller":
      return <ControllerPage />;
    case "marketplace":
      return <MarketplacePage />;
    case "addons":
      return <AddonsPage />;
    case "services":
      return <ServicesPage />;
    case "about":
      return <AboutPage />;
  }
}
