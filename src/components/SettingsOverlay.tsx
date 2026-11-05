import { Dialog } from "@base-ui/react/dialog";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "./Avatar";
import { Close, Reset, SignOut } from "./icons";
import { iconButtonClass } from "./ui/Button";
import { SearchField } from "./ui/SearchField";
import { useAccount } from "../lib/account";
import { closeSettings, type PageId, prefsCustomized, resetPrefs, searchSettings, type SettingEntry, usePrefs, useSettingsOverlay } from "../lib/settings";
import { SettingsPageBody } from "../screens/settings/SettingsPageBody";
import { PAGES } from "./settings/pages";

/** Sidebar groups, T3 Code style: an unlabelled first group, then headed ones. */
const GROUPS: { heading?: string; pages: PageId[] }[] = [
  { pages: ["account", "playback", "subtitles", "appearance", "browsing", "anime"] },
  { heading: "Input", pages: ["controls", "controller"] },
  { heading: "Sources", pages: ["sources", "marketplace", "addons", "services"] },
  { heading: "System", pages: ["advanced", "about"] },
];

/** Where a search result's row can be on its page. */
const ROW_LABELS = ".settings-row-title, .settings-group-title, .sub-setting-label, .shortcut-label";
const ROW_BOXES = ".settings-row, .settings-group-title, .sub-setting, .shortcut-row";

/** Scrolls a page to the setting (by its schema id, else by its label) and briefly highlights it. */
function revealSetting(root: HTMLElement, entry: SettingEntry) {
  const marked = root.querySelector<HTMLElement>(`[data-setting="${CSS.escape(entry.id)}"]`);
  const label = marked ?? [...root.querySelectorAll<HTMLElement>(ROW_LABELS)].find((el) => el.textContent?.trim() === entry.title);
  if (!label) return;
  const box = marked ?? label.closest<HTMLElement>(ROW_BOXES) ?? label;
  box.scrollIntoView({ block: "center" });
  box.removeAttribute("data-search-hit");
  void box.offsetWidth; // restart the highlight if it's already running
  box.setAttribute("data-search-hit", "");
  box.addEventListener("animationend", () => box.removeAttribute("data-search-hit"), { once: true });
}

/**
 * Settings as a window over the app (T3 Code, Discord, Obsidian): sidebar of
 * sections on the left, breadcrumb header and one scrolling page on the right.
 */
export function SettingsOverlay() {
  const { open, page: requested } = useSettingsOverlay();
  const account = useAccount();
  const prefs = usePrefs();
  const pages = account.enabled ? PAGES : PAGES.filter((p) => p.id !== "account");
  const fallback = pages.find((p) => p.id === "playback")?.id ?? pages[0].id;
  const [page, setPage] = useState<PageId>(fallback);
  const [query, setQuery] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  // Each opening lands on the requested page (or where it was left), search cleared.
  useEffect(() => {
    if (!open) return;
    if (requested && pages.some((p) => p.id === requested)) setPage(requested);
    setQuery("");
  }, [open, requested]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [page]);

  const current = pages.find((p) => p.id === page) ?? pages[0];
  const pageOf = (id: PageId) => pages.find((p) => p.id === id) ?? pages[0];
  const searching = query.trim() !== "";
  const results = useMemo(
    () => searchSettings(query, (id) => pageOf(id).label, new Set(pages.map((p) => p.id))),
    [query, pages], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const [selected, setSelected] = useState(0);
  const resultsList = useRef<HTMLDivElement>(null);
  // The setting to scroll to once its page has rendered.
  const [target, setTarget] = useState<{ entry: SettingEntry } | null>(null);

  useEffect(() => setSelected(0), [query]);

  useEffect(() => {
    resultsList.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  useEffect(() => {
    if (!target || !scroller.current) return;
    const root = scroller.current;
    const frame = requestAnimationFrame(() => revealSetting(root, target.entry));
    return () => cancelAnimationFrame(frame);
  }, [target, page]);

  const go = (id: PageId) => {
    setPage(id);
    setQuery("");
  };

  const pick = (entry: SettingEntry) => {
    go(entry.page);
    setTarget({ entry }); // a fresh object, so picking the same one again still scrolls
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && closeSettings()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="t3s-backdrop" />
        <Dialog.Popup
          className="t3s"
          aria-label="Settings"
          onKeyDown={(e) => {
            const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
            if (e.key === "/" && !typing) {
              e.preventDefault();
              searchInput.current?.focus();
            }
          }}
        >
          <nav className="t3s-sidebar" aria-label="Settings sections">
            <SearchField
              ref={searchInput}
              look="plain"
              className="t3s-search"
              value={query}
              onChange={setQuery}
              label="Search settings"
              placeholder="Search"
              kbd="/"
              role="combobox"
              aria-expanded={searching}
              aria-controls="t3s-results"
              aria-activedescendant={searching && results.length ? `t3s-result-${selected}` : undefined}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                  if (!results.length) return;
                  e.preventDefault();
                  const step = e.key === "ArrowDown" ? 1 : -1;
                  setSelected((i) => (i + step + results.length) % results.length);
                }
                if (e.key === "Enter" && results[selected]) pick(results[selected]);
              }}
            />

            <div className="t3s-groups">
              {searching ? (
                results.length ? (
                  <div className="t3s-results" id="t3s-results" role="listbox" aria-label="Matching settings" ref={resultsList}>
                    {results.map((entry, i) => {
                      const p = pageOf(entry.page);
                      return (
                        <div
                          key={entry.id}
                          id={`t3s-result-${i}`}
                          data-index={i}
                          className="t3s-result"
                          role="option"
                          aria-selected={i === selected}
                          onMouseMove={() => i !== selected && setSelected(i)}
                          onMouseDown={(e) => e.preventDefault()} // keep focus in the search field
                          onClick={() => pick(entry)}
                        >
                          <p.icon size={16} strokeWidth={2} />
                          <span className="t3s-result-text">
                            <span className="t3s-result-title">{entry.title}</span>
                            <span className="t3s-result-page">{p.label}</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="t3s-empty">No settings match “{query.trim()}”.</p>
                )
              ) : (
                GROUPS.map((g, i) => {
                  const items = pages.filter((p) => g.pages.includes(p.id));
                  if (!items.length) return null;
                  return (
                    <div className="t3s-group" role="group" aria-label={g.heading} key={g.heading ?? i}>
                      {g.heading && <h3 className="t3s-group-heading">{g.heading}</h3>}
                      {items.map((p) => (
                        <NavItem key={p.id} page={p} active={p.id === page} onClick={() => go(p.id)} />
                      ))}
                    </div>
                  );
                })
              )}
            </div>

            {account.enabled && (
              <div className="t3s-sidebar-foot">
                {account.status === "guest" ? (
                  <button className="t3s-nav-item" onClick={account.showSignIn}>
                    <SignOut size={16} strokeWidth={2} style={{ transform: "scaleX(-1)" }} />
                    <span>Sign in to sync</span>
                  </button>
                ) : account.profile ? (
                  <button className="t3s-nav-item" onClick={() => go("account")}>
                    <Avatar id={account.profile.avatar} style={{ width: 18, borderRadius: 5 }} />
                    <span>{account.profile.name}</span>
                  </button>
                ) : null}
              </div>
            )}
          </nav>

          <div className="t3s-main">
            <header className="t3s-header">
              <Dialog.Title className="t3s-crumbs">
                <span className="t3s-crumb-root">Settings</span>
                <span className="t3s-crumb-sep" aria-hidden>
                  /
                </span>
                <span className="t3s-crumb-page">{current.label}</span>
              </Dialog.Title>
              <div className="t3s-header-actions">
                <button
                  className="t3s-ghost"
                  disabled={!prefsCustomized(prefs)}
                  onClick={resetPrefs}
                  title="Interface sounds and controller notices on this device"
                >
                  <Reset size={14} strokeWidth={2.2} />
                  <span className="t3s-ghost-label">Restore device defaults</span>
                </button>
                <Dialog.Close className={iconButtonClass("settings")} aria-label="Close settings">
                  <Close size={16} strokeWidth={2.2} />
                </Dialog.Close>
              </div>
            </header>

            <div className="t3s-scroll" ref={scroller}>
              <div className="t3s-page" key={page}>
                <SettingsPageBody page={page} />
              </div>
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function NavItem({
  page,
  active,
  onClick,
}: {
  page: (typeof PAGES)[number];
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button className="t3s-nav-item" data-active={active} aria-current={active ? "page" : undefined} onClick={onClick}>
      <page.icon size={16} strokeWidth={2} />
      <span>{page.label}</span>
    </button>
  );
}
