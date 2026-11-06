import { afterEach, expect, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { DownloadButton } from "../../src/components/DownloadButton";
import { downloadedStream, type Download } from "../../src/lib/library";
import { queryClient } from "../../src/lib/net";
import { click, press, render } from "./render";

const settle = (ms = 20) => act(async () => new Promise((r) => setTimeout(r, ms)));

const record = (state: Download["state"]): Download => ({
  id: "tt0000001:1:5",
  metaId: "tt0000001",
  type: "series",
  name: "The Lighthouse Keepers",
  season: 1,
  episode: 5,
  episodeTitle: "Low Tide",
  quality: "1080p",
  file: "/downloads/episode.mkv",
  received: 100,
  total: 100,
  state,
  addedAt: 0,
});

// The native side: the commands the button sends, answered with nothing.
const calls: string[] = [];
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string) => {
    calls.push(cmd);
    return cmd === "downloads_list" ? [] : null;
  },
};
afterEach(() => {
  calls.length = 0;
});

async function mount(d: Download) {
  queryClient.setQueryData(["downloads"], [d]);
  return render(
    <QueryClientProvider client={queryClient}>
      <DownloadButton
        item={{ id: d.metaId, type: d.type, name: d.name }}
        video={{ id: d.id, title: d.episodeTitle!, season: d.season!, episode: d.episode! }}
      />
    </QueryClientProvider>,
  );
}

test("a downloaded episode shows Show in Folder and Delete as buttons, no menu and no Play Download (#25)", async () => {
  const { container, unmount } = await mount(record("done"));
  const buttons = [...container.querySelectorAll("button")];
  expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual(["Show Downloaded Episode in Folder", "Delete Downloaded Episode"]);
  expect(container.querySelector("[aria-haspopup]")).toBeNull();
  expect(document.body.textContent).not.toContain("Play Download");

  await click(buttons[0]);
  expect(calls).toEqual(["download_reveal"]);
  await unmount();
});

test("Delete takes a second click, and Escape stands it down", async () => {
  const { container, unmount } = await mount(record("done"));
  const del = container.querySelector<HTMLButtonElement>(".confirm-delete")!;
  await click(del);
  expect(del.hasAttribute("data-armed")).toBe(true);
  expect(del.getAttribute("aria-label")).toBe("Click again to delete the downloaded episode");
  del.focus();
  await press("Escape", del);
  expect(del.hasAttribute("data-armed")).toBe(false);

  await click(del);
  await click(del);
  await settle(300);
  expect(calls).toContain("download_remove");
  await unmount();
});

test("a download still coming down keeps its menu", async () => {
  const { container, unmount } = await mount(record("downloading"));
  expect(container.querySelectorAll("button")).toHaveLength(1);
  expect(container.querySelector(".confirm-delete")).toBeNull();
  await unmount();
});

test("a title's Play takes the finished download of that video; otherwise the add-ons as before", () => {
  const list = [record("done"), { ...record("downloading"), id: "tt0000001:1:6" }];
  expect(downloadedStream(list, "tt0000001:1:5")).toEqual({ url: "/downloads/episode.mkv", title: "1080p" });
  expect(downloadedStream(list, "tt0000001:1:6")).toBeUndefined();
  expect(downloadedStream(list, "tt0000001:1:7")).toBeUndefined();
  expect(downloadedStream(undefined, "tt0000001:1:5")).toBeUndefined();
});
