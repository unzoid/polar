import { expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LetterboxdImport } from "../../src/components/settings/LetterboxdImport";
import type { LibraryItem, MetaPreview, Progress } from "../../src/lib/types";
import { byText, click, render } from "./render";

// An invented export: one film found by title and year, one with two films of that name and year, one rated.
const WATCHED = `Date,Name,Year,Letterboxd URI
2024-03-01,The Lantern Keepers,2001,https://boxd.example.com/a1
2024-03-02,Twin Harbours,1999,https://boxd.example.com/a2
`;
const WATCHLIST = `Date,Name,Year,Letterboxd URI
2023-12-24,Paper Moons,1953,https://boxd.example.com/w1
`;
const RATINGS = `Date,Name,Year,Letterboxd URI,Rating
2024-03-01,The Lantern Keepers,2001,https://boxd.example.com/a1,4
`;

const film = (id: string, name: string, year: string): MetaPreview => ({ id, type: "movie", name, releaseInfo: year });
const CATALOG = [
  film("tt0000001", "The Lantern Keepers", "2001"),
  film("tt0000002", "Twin Harbours", "1999"),
  film("tt0000003", "Twin Harbours", "1999"),
  film("tt0000004", "Paper Moons", "1953"),
];

// The native side: the catalog's year search and the library import, which records what it's given.
const imported: { library: LibraryItem[]; progress: Progress[] }[] = [];
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: Record<string, unknown>) => {
    if (cmd === "search_movies") {
      const q = String(args.query).toLowerCase();
      return CATALOG.filter((m) => m.name.toLowerCase().includes(q) && (args.year == null || m.releaseInfo === String(args.year)));
    }
    if (cmd === "library_import") {
      const a = args as { library: LibraryItem[]; progress: Progress[] };
      imported.push(a);
      return { library: a.library.length, progress: a.progress.length };
    }
    return null;
  },
};

const settle = () => act(async () => new Promise((r) => setTimeout(r, 30)));

test("Letterboxd import: films found by title and year are imported, the rest are left to pick, ratings are said to be skipped (#87)", async () => {
  const qc = new QueryClient();
  const { container, unmount } = await render(
    <QueryClientProvider client={qc}>
      <LetterboxdImport />
    </QueryClientProvider>,
  );
  const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
  const files = [new File([WATCHED], "watched.csv", { type: "text/csv" }), new File([WATCHLIST], "watchlist.csv"), new File([RATINGS], "ratings.csv")];
  Object.defineProperty(input, "files", { value: files, configurable: true });
  await act(async () => void input.dispatchEvent(new Event("change", { bubbles: true })));
  await settle();

  expect(byText(container, ".settings-row-title", "Watchlist").nextElementSibling?.textContent).toBe("1 film, added to your library");
  expect(byText(container, ".settings-row-title", "Watched").nextElementSibling?.textContent).toBe("2 films, marked watched");
  expect(container.textContent).toContain("Ratings aren't imported");
  const go = byText(container, ".settings-row-title", "Find and import 3 films");

  await click(go.parentElement!.parentElement!.querySelector("button"));
  await settle();

  expect(imported).toHaveLength(1);
  expect(imported[0].library.map((i) => i.id)).toEqual(["tt0000004"]);
  expect(imported[0].progress.map((p) => p.metaId)).toEqual(["tt0000001"]);
  expect(container.textContent).toContain("Found 2 films: added 1 film to your library and marked 1 film watched. 1 film to pick below.");

  // Two films of that name and year: offered, never taken; picking one imports it as watched.
  const row = byText(container, ".settings-row-title", "Twin Harbours (1999)").closest(".settings-pick")!;
  const choices = [...row.querySelectorAll(".settings-pick-choices button")];
  expect(choices.map((b) => b.textContent)).toEqual(["Twin Harbours (1999)", "Twin Harbours (1999)"]);
  await click(choices[1]);
  await settle();
  expect(imported[1].progress.map((p) => p.metaId)).toEqual(["tt0000003"]);
  expect(container.querySelector(".settings-pick")).toBeNull();
  expect(container.textContent).toContain("marked 2 films watched");
  await unmount();
});
