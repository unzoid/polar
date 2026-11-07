import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TraktSignIn } from "../../src/components/settings/TraktSignIn";
import { ServicesPage } from "../../src/screens/settings/ServicesPage";
import { AccountContext, type Account } from "../../src/lib/account";
import { keys } from "../../src/lib/net";
import type { KeyStorage } from "../../src/lib/platform/keychain";
import { setTraktLinkStorage, traktLinkName, type TraktLink } from "../../src/lib/trakt/link";
import { byText, click, render } from "./render";

// #85: the profile's Trakt link in Settings, signed in with a device code.
const link: TraktLink = { token: "TOKEN", refreshToken: "REFRESH", expiresAt: Date.now() + 6 * 86_400_000, slug: "someone", name: "Someone" };
const realFetch = globalThis.fetch;
let keychain: Map<string, string>;
let asked: { path: string; body: unknown; auth?: string }[] = [];
let tokenAnswers: number[] = [];

function memoryKeychain(): KeyStorage {
  return {
    getItem: async (k) => keychain.get(k) ?? null,
    setItem: async (k, v) => void keychain.set(k, v),
    removeItem: async (k) => void keychain.delete(k),
    peek: (k) => keychain.get(k),
  };
}

beforeEach(() => {
  keychain = new Map();
  setTraktLinkStorage(memoryKeychain());
  asked = [];
  tokenAnswers = [400, 200];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const path = url.replace("https://api.trakt.tv", "");
    const headers = init.headers as Record<string, string>;
    asked.push({ path, body: init.body ? JSON.parse(String(init.body)) : undefined, auth: headers.Authorization });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
    if (path === "/oauth/device/code")
      return json({ device_code: "DEVICE", user_code: "5055CC52", verification_url: "https://trakt.tv/activate", expires_in: 600, interval: 1 });
    if (path === "/oauth/device/token") {
      const status = tokenAnswers.shift() ?? 400;
      return status === 200 ? json({ access_token: "NEW", refresh_token: "NEWR", expires_in: 604800 }) : new Response(null, { status });
    }
    if (path === "/users/settings") return json({ user: { username: "someone", name: "Someone", ids: { slug: "someone" } } });
    if (path === "/oauth/revoke") return json({});
    if (path.startsWith("/sync/watchlist"))
      return json([{ type: "movie", listed_at: "2026-01-02T00:00:00.000Z", movie: { title: "Night Train", ids: { imdb: "tt0000001" } } }]);
    if (path === "/sync/watched/movies") return json([]);
    if (path === "/sync/watched/shows")
      return json([
        {
          last_watched_at: "2026-03-01T00:00:00.000Z",
          show: { title: "Harbour Lights", ids: { imdb: "tt0000002" } },
          seasons: [{ number: 1, episodes: [{ number: 1 }, { number: 2 }] }],
        },
        { last_watched_at: "2026-03-01T00:00:00.000Z", show: { title: "Elsewhere", ids: {} }, seasons: [] },
      ]);
    if (path === "/sync/last_activities") return json({ all: "2026-01-01T00:00:00.000Z", movies: {}, episodes: {}, shows: {} });
    return new Response(null, { status: 404 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setTraktLinkStorage(undefined);
  localStorage.clear();
});

const wrap = (node: React.ReactNode) => {
  const qc = new QueryClient();
  qc.setQueryData(keys.settings, {});
  const signedOut = { status: "signed-out", profile: null, profiles: [], enabled: false } as unknown as Account;
  return render(
    <QueryClientProvider client={qc}>
      <AccountContext.Provider value={signedOut}>{node}</AccountContext.Provider>
    </QueryClientProvider>,
  );
};

async function settle(rounds = 5) {
  for (let i = 0; i < rounds; i++) await act(async () => new Promise((r) => setTimeout(r, 10)));
}

test("Settings: without a client id the row says so, with Trakt's notice", async () => {
  const view = await wrap(<ServicesPage />);
  await settle();
  await click(byText(view.container, ".settings-row-title, .settings-row-button *", "Trakt").closest("button"));
  expect(view.container.textContent).toContain("signing in to Trakt needs Polarity registered with Trakt first");
  expect(view.container.textContent).toContain("Polarity is not endorsed or certified by Trakt.");
  expect(asked).toEqual([]);
  await view.unmount();
});

test("Settings: a linked profile sees its account, switches the watchlist step on and unlinks, which revokes the token", async () => {
  keychain.set(traktLinkName(null), JSON.stringify(link));
  const view = await wrap(<ServicesPage />);
  await settle();
  await click(byText(view.container, ".settings-row-title, .settings-row-button *", "Trakt").closest("button"));
  expect(view.container.textContent).toContain("Linked as Someone");
  const step = byText(view.container, "label", "Keep the library and the Trakt watchlist in step").querySelector("input")!;
  expect(step.checked).toBe(false);
  await click(step);
  await settle();
  expect(JSON.parse(keychain.get(traktLinkName(null))!).watchlist).toBe(true);
  expect((byText(view.container, "label", "Keep the library and the Trakt watchlist in step").querySelector("input") as HTMLInputElement).checked).toBe(true);
  await click(byText(view.container, "button", "Unlink"));
  await settle();
  expect(keychain.has(traktLinkName(null))).toBe(false);
  expect(asked.at(-1)).toMatchObject({ path: "/oauth/revoke", body: { token: "TOKEN" } });
  await view.unmount();
});

test("the sign-in shows the code, waits for Trakt and links the profile", async () => {
  const view = await wrap(<TraktSignIn space={null} />);
  await click(byText(view.container, "button", "Get a code"));
  await settle();
  expect(view.container.querySelector(".device-code")?.textContent).toBe("5055CC52");
  expect(view.container.textContent).toContain("trakt.tv/activate");
  expect(view.container.textContent).toContain("Waiting for you to allow Polarity on Trakt");
  // Two polls a second apart: still waiting, then allowed.
  for (let i = 0; i < 30 && !keychain.has(traktLinkName(null)); i++) await settle(10);
  expect(JSON.parse(keychain.get(traktLinkName(null))!)).toMatchObject({ token: "NEW", refreshToken: "NEWR", slug: "someone", name: "Someone" });
  expect(asked.filter((a) => a.path === "/oauth/device/token")).toHaveLength(2);
  expect(asked.find((a) => a.path === "/users/settings")?.auth).toBe("Bearer NEW");
  await view.unmount();
});

test("a declined code says so and offers a new one; closing stops the polls", async () => {
  tokenAnswers = [418];
  const view = await wrap(<TraktSignIn space={null} />);
  await click(byText(view.container, "button", "Get a code"));
  for (let i = 0; i < 30 && !view.container.querySelector('[role="alert"]'); i++) await settle(10);
  expect(view.container.textContent).toContain("The code was declined on Trakt");
  expect(byText(view.container, "button", "Get a new code")).toBeTruthy();

  tokenAnswers = [];
  await click(byText(view.container, "button", "Get a new code"));
  await settle();
  await click(byText(view.container, "button", "Cancel"));
  const polls = asked.filter((a) => a.path === "/oauth/device/token").length;
  await settle(150);
  expect(asked.filter((a) => a.path === "/oauth/device/token").length).toBe(polls);
  expect(byText(view.container, "button", "Get a code")).toBeTruthy();
  await view.unmount();
});

test("Settings: a linked profile imports its Trakt watchlist and watched episodes into the library", async () => {
  keychain.set(traktLinkName(null), JSON.stringify(link));
  const imported: { library: { id: string }[]; progress: { videoId: string }[] }[] = [];
  const w = window as { __TAURI_INTERNALS__?: unknown };
  w.__TAURI_INTERNALS__ = {
    invoke: async (cmd: string, args: { library: { id: string }[]; progress: { videoId: string }[] }) => {
      if (cmd !== "library_import") return null;
      imported.push(args);
      return { library: args.library.length, progress: args.progress.length };
    },
  };
  try {
    const view = await wrap(<ServicesPage />);
    await settle();
    await click(byText(view.container, ".settings-row-title, .settings-row-button *", "Trakt").closest("button"));
    await click(byText(view.container, "button", "Import from Trakt…"));
    await settle();
    expect(view.container.textContent).toContain("1 film on your watchlist. 2 episodes watched. 1 title without an IMDb page left out.");
    await click(byText(view.container, "label", "Add the watchlist to the library").querySelector("input"));
    await click(byText(view.container, "button", "Import"));
    await settle();
    expect(imported).toHaveLength(1);
    expect(imported[0].library).toEqual([]);
    expect(imported[0].progress.map((r) => r.videoId)).toEqual(["tt0000002:1:1", "tt0000002:1:2"]);
    expect(view.container.textContent).toContain("Added 0 titles to your library and 2 watched films and episodes.");
    await view.unmount();
  } finally {
    delete w.__TAURI_INTERNALS__;
  }
});
