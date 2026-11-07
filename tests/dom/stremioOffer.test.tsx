import { afterAll, afterEach, expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StremioLinks } from "../../src/components/StremioLinks";
import { dismissAddonOffer, offerAddon } from "../../src/lib/deepLink";
import { api } from "../../src/lib/api";
import { byText, click, render } from "./render";

// The card a stremio:// install link shows (#163).

const installed: string[] = [];
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: { url: string }) => {
    if (cmd === "addon_preview") return { name: args.url.includes("two") ? "Second Add-on" : "First Add-on" };
    if (cmd === "addon_install") return void installed.push(args.url);
    return null;
  },
};
afterEach(() => {
  installed.length = 0;
  dismissAddonOffer();
});
// The files after this one run in the browser shell.
afterAll(() => void delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);

const settle = (ms = 20) => act(async () => new Promise((r) => setTimeout(r, ms)));
const offer = (url: string) => act(async () => offerAddon(url, { preview: api.previewAddon, install: api.installAddon }));
const installButton = () => byText(document.body, "button", "Install") as HTMLButtonElement;

test("Install waits a moment after the add-on shows, and again when a newer link replaces the card", async () => {
  const { unmount } = await render(
    <QueryClientProvider client={new QueryClient()}>
      <StremioLinks tv={false} />
    </QueryClientProvider>,
  );
  await offer("https://one.example.com/manifest.json");
  await settle();
  expect(document.body.textContent).toContain("Install First Add-on?");
  expect(installButton().disabled).toBe(true);
  await settle(1050);
  expect(installButton().disabled).toBe(false);

  // A second link takes the card just before the click: the click lands on a button that isn't ready yet.
  await offer("https://two.example.com/manifest.json");
  await settle();
  expect(document.body.textContent).toContain("Install Second Add-on?");
  await click(installButton());
  await settle();
  expect(installed).toEqual([]);

  await settle(1050);
  await click(installButton());
  await settle();
  expect(installed).toEqual(["https://two.example.com/manifest.json"]);
  await unmount();
});
