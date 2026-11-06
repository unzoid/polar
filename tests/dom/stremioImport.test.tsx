import { expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StremioImport } from "../../src/components/settings/StremioImport";
import { keys } from "../../src/lib/net";
import { byText, click, render } from "./render";

// An invented export: a movie in the library, a show only in Continue Watching, an item from another catalog, two add-ons.
const file = JSON.stringify({
  addons: {
    addons: [
      { transportUrl: "https://one.example.org/manifest.json", flags: {}, manifest: { id: "org.example.one", name: "Example One" } },
      { transportUrl: "https://two.example.org/manifest.json", flags: {}, manifest: { id: "org.example.two", name: "Example Two" } },
    ],
  },
  library: {
    uid: "0001",
    items: {
      tt0000005: { _id: "tt0000005", type: "movie", name: "Night Ferry", removed: false, temp: false, state: {} },
      tt0000001: {
        _id: "tt0000001",
        type: "series",
        name: "Lantern Keepers",
        removed: true,
        temp: true,
        state: { video_id: "tt0000001:1:2", timeOffset: 5_000, duration: 10_000 },
      },
      "other:abc": { _id: "other:abc", type: "series", name: "Elsewhere", removed: false, state: {} },
    },
  },
});

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));

test("Stremio import: the movie in the library is counted, and Import comes after every choice, add-ons included (#152)", async () => {
  const qc = new QueryClient();
  qc.setQueryData(keys.addons, []);
  const { container, unmount } = await render(
    <QueryClientProvider client={qc}>
      <StremioImport />
    </QueryClientProvider>,
  );
  const input = container.querySelector<HTMLInputElement>("input[type=file]")!;
  Object.defineProperty(input, "files", { value: [new File([file], "export.json", { type: "application/json" })], configurable: true });
  await act(async () => void input.dispatchEvent(new Event("change", { bubbles: true })));
  await settle();

  const text = container.textContent ?? "";
  expect(byText(container, ".settings-row-title", "Library").nextElementSibling?.textContent).toBe("1 title");
  expect(text).toContain("1 title from other catalogs (not IMDb or Kitsu ids)");

  const rows = [...container.querySelectorAll(".settings-row-title")].map((t) => t.textContent ?? "");
  const at = (label: string) => rows.findIndex((r) => r.startsWith(label));
  const importRow = rows.findIndex((r) => r.startsWith("Import "));
  expect(importRow).toBe(rows.length - 1);
  for (const label of ["Library", "Where you left off", "Watched", "All add-ons", "Example One", "Example Two"]) expect(at(label)).toBeLessThan(importRow);
  expect(rows[importRow]).toBe("Import 1 movie and 1 title in progress");

  await click(byText(container, ".settings-row-title", "All add-ons").closest("label")!.querySelector("[role=switch]"));
  await settle();
  expect([...container.querySelectorAll(".settings-row-title")].at(-1)!.textContent).toBe("Import 1 movie, 1 title in progress and 2 add-ons");
  await unmount();
});
