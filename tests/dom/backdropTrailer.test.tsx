import { expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useBackdropTrailer } from "../../src/components/BackdropTrailer";
import { keys } from "../../src/lib/net";
import { render } from "./render";

const FILE = "https://media.example.com/film.mp4";

function Backdrop() {
  return useBackdropTrailer("tt0000001", { active: true }).node;
}

test("Backdrop trailer: plays the file itself with cover and the fixed zoom, never measuring its frames (#32)", async () => {
  document.documentElement.dataset.reduceMotion = "off";
  // Inside the shell, where the trailer used to go through the app's own protocol.
  const w = window as { __TAURI_INTERNALS__?: unknown };
  w.__TAURI_INTERNALS__ = { convertFileSrc: (path: string, protocol: string) => `${protocol}://localhost/${path}` };
  const qc = new QueryClient();
  qc.setQueryData(keys.settings, { trailerAutoplay: true, trailerSound: false });
  qc.setQueryData(keys.trailer("tt0000001"), { url: FILE });
  const drawn: unknown[] = [];
  const canvas = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (...args: unknown[]) {
    drawn.push(args);
    return null;
  } as typeof canvas;
  try {
    const { container, unmount } = await render(
      <QueryClientProvider client={qc}>
        <Backdrop />
      </QueryClientProvider>,
    );
    // The page shows its art for a few seconds first.
    await act(async () => new Promise((r) => setTimeout(r, 4100)));
    const video = container.querySelector<HTMLVideoElement>(".backdrop-trailer video");
    expect(video).not.toBeNull();
    expect(video!.getAttribute("src")).toBe(FILE);
    expect(video!.hasAttribute("crossorigin")).toBe(false);
    Object.defineProperty(video, "videoWidth", { value: 1920 });
    Object.defineProperty(video, "videoHeight", { value: 1080 });
    await act(async () => void video!.dispatchEvent(new Event("playing")));
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(drawn).toEqual([]);
    expect(video!.style.transform).toBe("");
    expect(container.querySelector(".backdrop-trailer")!.getAttribute("data-visible")).toBe("true");
    await unmount();
  } finally {
    HTMLCanvasElement.prototype.getContext = canvas;
    delete w.__TAURI_INTERNALS__;
    delete document.documentElement.dataset.reduceMotion;
  }
}, 10_000);
