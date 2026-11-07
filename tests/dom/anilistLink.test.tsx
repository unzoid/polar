import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AnimeListPanel } from "../../src/components/anime/AnimeListPanel";
import { ServicesPage } from "../../src/screens/settings/ServicesPage";
import type { Anime } from "../../src/lib/anime";
import { keys } from "../../src/lib/net";
import { AccountContext, type Account } from "../../src/lib/account";
import { linkName, setLinkStorage, type Link } from "../../src/lib/lists/linkStore";
import { pendingOps, queueKey } from "../../src/lib/lists/queue";
import type { KeyStorage } from "../../src/lib/platform/keychain";
import { byText, click, render } from "./render";

// #83: the profile's AniList link in Settings, and its entry on the anime page.
const link: Link = { token: "TOKEN", expiresAt: Date.now() + 3600_000, userId: 7, userName: "Someone", scoreFormat: "POINT_10", adult: false };
const anime = { id: 5, episodes: 12 } as unknown as Anime;
const realFetch = globalThis.fetch;
let keychain: Map<string, string>;
let asked: { query: string; variables: Record<string, unknown> }[] = [];

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
  setLinkStorage(memoryKeychain());
  asked = [];
  globalThis.fetch = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
    asked.push(body);
    if (body.query.includes("SaveMediaListEntry")) {
      const saved = { id: 9, mediaId: 5, status: "CURRENT", progress: body.variables.p, score: 7, repeat: 0, updatedAt: 2 };
      return new Response(JSON.stringify({ data: { SaveMediaListEntry: saved } }), { status: 200 });
    }
    if (body.query.includes("MediaListCollection")) {
      const media = (format: string, isAdult = false) => ({ episodes: 12, isAdult, format, title: { romaji: "Asagiri" }, coverImage: {} });
      const entries = [
        { id: 1, mediaId: 5, status: "CURRENT", progress: 3, score: 0, repeat: 0, updatedAt: 1, media: media("TV") },
        { id: 2, mediaId: 6, status: "COMPLETED", progress: 1, score: 0, repeat: 0, updatedAt: 1, media: media("MOVIE") },
        { id: 3, mediaId: 7, status: "PLANNING", progress: 0, score: 0, repeat: 0, updatedAt: 1, media: media("TV", true) },
      ];
      return new Response(JSON.stringify({ data: { MediaListCollection: { hasNextChunk: false, lists: [{ entries }] } } }), { status: 200 });
    }
    const mediaList = body.query.includes("mediaList(userId: $u, mediaId: $m)")
      ? [{ id: 9, mediaId: 5, status: "CURRENT", progress: 3, score: 7, repeat: 0, updatedAt: 1 }]
      : [];
    return new Response(JSON.stringify({ data: { Page: { mediaList } } }), { status: 200 });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  localStorage.removeItem(queueKey(null));
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

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 10)));
}

test("the anime page shows nothing for a profile that hasn't linked AniList", async () => {
  const view = await wrap(<AnimeListPanel anime={anime} />);
  await settle();
  expect(view.container.textContent).toBe("");
  expect(asked).toEqual([]);
  await view.unmount();
});

test("a linked profile sees its entry, read fresh, and an episode more goes into the queue", async () => {
  keychain.set(linkName("anilist", null), JSON.stringify(link));
  const view = await wrap(<AnimeListPanel anime={anime} />);
  await settle();
  expect(view.container.textContent).toContain("Watching");
  expect(view.container.textContent).toContain("3 / 12");
  expect((view.container.querySelector("#anime-list-score") as HTMLInputElement).value).toBe("7");
  await click(view.container.querySelector('[aria-label="One episode more"]'));
  expect(view.container.textContent).toContain("4 / 12");
  // Queued, then sent at once.
  await settle();
  expect(asked.find((a) => a.query.includes("SaveMediaListEntry"))?.variables).toMatchObject({ m: 5, p: 4 });
  expect(pendingOps(null)).toEqual([]);
  await view.unmount();
});

test("Settings: without a registered client the row says so; a linked profile can unlink", async () => {
  const off = await wrap(<ServicesPage />);
  await settle();
  await click(byText(off.container, ".settings-row-title, .settings-row-button *", "AniList").closest("button"));
  expect(off.container.textContent).toContain("Not set up in this build");
  await off.unmount();

  keychain.set(linkName("anilist", null), JSON.stringify(link));
  const on = await wrap(<ServicesPage />);
  await settle();
  await click(byText(on.container, ".settings-row-title, .settings-row-button *", "AniList").closest("button"));
  expect(on.container.textContent).toContain("Linked as Someone");
  // The import reads the whole list first and says what it holds, adult entries left out.
  await click(byText(on.container, "button", "Import List…"));
  await settle();
  expect(asked.at(-1)?.variables).toMatchObject({ u: 7, c: 1 });
  expect(on.container.textContent).toContain("1 show and 1 film on your list, 4 episodes and films watched. 1 adult entry left out");
  expect(byText(on.container, "button", "Import")).toBeTruthy();
  await click(byText(on.container, "button", "Unlink"));
  await settle();
  expect(keychain.has(linkName("anilist", null))).toBe(false);
  expect(on.container.textContent).toContain("Not set up in this build");
  await on.unmount();
});
