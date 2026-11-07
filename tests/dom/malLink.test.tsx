import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AnimeListPanels } from "../../src/components/anime/AnimeListPanel";
import { ServicesPage } from "../../src/screens/settings/ServicesPage";
import type { Anime } from "../../src/lib/anime";
import { keys } from "../../src/lib/net";
import { AccountContext, type Account } from "../../src/lib/account";
import type { RelayRequest } from "../../src/lib/lists/entry";
import { linkName, setLinkStorage, type Link } from "../../src/lib/lists/linkStore";
import { pendingOps } from "../../src/lib/lists/queue";
import type { KeyStorage } from "../../src/lib/platform/keychain";
import { byText, click, render } from "./render";

// #84: the profile's MyAnimeList link in Settings, and its entry on the anime page, through the native relay.
const DAY = 24 * 60 * 60_000;
const link: Link = {
  token: "TOKEN",
  expiresAt: Date.now() + 20 * DAY,
  refreshToken: "REFRESH",
  refreshBy: Date.now() + 25 * DAY,
  userId: 77,
  userName: "Someone",
  scoreFormat: "POINT_10",
  adult: false,
};
const anime = { id: 5, idMal: 21, episodes: 12 } as unknown as Anime;
let keychain: Map<string, string>;
let asked: RelayRequest[] = [];

function memoryKeychain(): KeyStorage {
  return {
    getItem: async (k) => keychain.get(k) ?? null,
    setItem: async (k, v) => void keychain.set(k, v),
    removeItem: async (k) => void keychain.delete(k),
    peek: (k) => keychain.get(k),
  };
}

const status = (watched: number) => ({
  status: "watching",
  score: 7,
  num_episodes_watched: watched,
  is_rewatching: false,
  num_times_rewatched: 0,
  updated_at: "2026-01-02T00:00:00Z",
});

beforeEach(() => {
  keychain = new Map();
  setLinkStorage(memoryKeychain());
  asked = [];
  mockIPC((cmd, args) => {
    if (cmd !== "mal_api") return null;
    const req = args as unknown as RelayRequest;
    asked.push(req);
    const answer = (body: unknown) => ({ status: 200, body: JSON.stringify(body) });
    if (req.method === "PATCH") return answer(status(Number(new Map(req.form).get("num_watched_episodes") ?? 3)));
    if (req.path === "anime/21") return answer({ id: 21, my_list_status: status(3) });
    if (req.path === "users/@me/animelist") {
      const node = (id: number, media_type: string, nsfw = "white") => ({ id, title: `Show ${id}`, num_episodes: 12, media_type, nsfw });
      return answer({
        data: [
          { node: node(21, "tv"), list_status: status(3) },
          { node: node(22, "movie"), list_status: { ...status(1), status: "completed" } },
          { node: node(23, "tv", "black"), list_status: { ...status(0), status: "plan_to_watch" } },
        ],
        paging: {},
      });
    }
    return { status: 404, body: "" };
  });
});
afterEach(() => {
  clearMocks();
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

test("a profile linked to MyAnimeList sees its entry by the anime's MAL id, and an episode more goes out", async () => {
  keychain.set(linkName("mal", null), JSON.stringify(link));
  const view = await wrap(<AnimeListPanels anime={anime} />);
  await settle();
  const text = view.container.textContent ?? "";
  expect(text).toContain("Your MyAnimeList");
  expect(text).not.toContain("Your AniList");
  expect(text).toContain("3 / 12");
  expect(text).toContain("Uses the MyAnimeList API");
  expect(asked[0]).toMatchObject({ method: "GET", path: "anime/21", token: "TOKEN" });
  expect((view.container.querySelector("#anime-list-score-mal") as HTMLInputElement).value).toBe("7");
  await click(view.container.querySelector('[aria-label="One episode more"]'));
  expect(view.container.textContent).toContain("4 / 12");
  await settle();
  expect(asked.find((a) => a.method === "PATCH")).toMatchObject({ path: "anime/21/my_list_status", form: [["num_watched_episodes", "4"]] });
  expect(pendingOps("mal", null)).toEqual([]);
  await view.unmount();
});

test("an anime without a MAL id shows no MyAnimeList panel", async () => {
  keychain.set(linkName("mal", null), JSON.stringify(link));
  const view = await wrap(<AnimeListPanels anime={{ ...anime, idMal: null } as Anime} />);
  await settle();
  expect(view.container.textContent).toBe("");
  expect(asked).toEqual([]);
  await view.unmount();
});

test("Settings: without a client id the row says so; a linked profile imports and unlinks", async () => {
  const off = await wrap(<ServicesPage />);
  await settle();
  await click(byText(off.container, ".settings-row-title, .settings-row-button *", "MyAnimeList").closest("button"));
  expect(off.container.textContent).toContain("signing in to MyAnimeList needs Polarity registered");
  await off.unmount();

  keychain.set(linkName("mal", null), JSON.stringify(link));
  const on = await wrap(<ServicesPage />);
  await settle();
  await click(byText(on.container, ".settings-row-title, .settings-row-button *", "MyAnimeList").closest("button"));
  expect(on.container.textContent).toContain("Linked as Someone");
  await click(byText(on.container, "button", "Import List…"));
  await settle();
  expect(asked.at(-1)).toMatchObject({ path: "users/@me/animelist", token: "TOKEN" });
  // MAL doesn't say whether the account shows adult entries: left out, without blaming a setting.
  expect(on.container.textContent).toContain("1 show and 1 film on your list, 4 episodes and films watched. 1 adult entry left out.");
  await click(byText(on.container, "button", "Unlink"));
  await settle();
  expect(keychain.has(linkName("mal", null))).toBe(false);
  await on.unmount();
});
