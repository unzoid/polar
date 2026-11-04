import type { PageId } from "./settings/pages";
import { ACTIONS } from "./keybinds";
import { SETTINGS } from "./settings/schema";

/**
 * Every individual setting, for the settings search: the schema's entries, then each shortcut.
 * A result scrolls to the row marked `data-setting={id}`, or else to the row titled `title`.
 */
export type SettingEntry = { id: string; title: string; page: PageId; keywords?: string };

const ROWS: SettingEntry[] = SETTINGS.map(({ id, title, page, keywords }) => ({ id, title, page, keywords }));

/** Each rebindable shortcut, found under Controls & TV. */
const SHORTCUTS: SettingEntry[] = ACTIONS.map((a) => ({
  id: `shortcut:${a.id}`,
  title: a.label,
  page: "controls",
  keywords: "keyboard shortcut keybind hotkey",
}));

export const SETTINGS_INDEX: SettingEntry[] = [...ROWS, ...SHORTCUTS];

/**
 * Settings matching a query, best first: titles starting with it, then titles
 * containing it, then matches on the page name or keywords.
 */
export function searchSettings(query: string, pageLabel: (id: PageId) => string, pages: Set<PageId>) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const scored: { entry: SettingEntry; score: number; i: number }[] = [];
  SETTINGS_INDEX.forEach((entry, i) => {
    if (!pages.has(entry.page)) return;
    const title = entry.title.toLowerCase();
    const score = title.startsWith(q)
      ? 0
      : title.split(/\W+/).some((w) => w.startsWith(q))
        ? 1
        : title.includes(q)
          ? 2
          : `${pageLabel(entry.page)} ${entry.keywords ?? ""}`.toLowerCase().includes(q)
            ? 3
            : -1;
    if (score >= 0) scored.push({ entry, score, i });
  });
  return scored.sort((a, b) => a.score - b.score || a.i - b.i).map((s) => s.entry);
}
