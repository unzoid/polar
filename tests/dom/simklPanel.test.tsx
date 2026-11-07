import { afterEach, beforeEach, expect, spyOn, test } from "bun:test";
import { act } from "react";
import { SimklPanel } from "../../src/components/title/SimklPanel";
import { api } from "../../src/lib/api";
import type { KeyStorage } from "../../src/lib/platform/keychain";
import { setSimklLinkStorage, simklLinkName, type SimklLink } from "../../src/lib/simkl/link";
import { simklItems, simklItemsKey } from "../../src/lib/simkl/pull";
import { simklRatings } from "../../src/lib/simkl/ratings";
import { byText, click, render } from "./render";

// #86: a linked profile puts a title on a Simkl list and rates it 1–10 from its page, with a link to its Simkl page.
const link: SimklLink = { token: "TOKEN", refreshToken: "REFRESH", expiresAt: Date.now() + 6 * 86_400_000, account: 42, name: "Someone" };
const film = { id: "tt0000001", type: "movie" as const };
const realFetch = globalThis.fetch;
let keychain: Map<string, string>;
let asked: { path: string; body: unknown }[] = [];

function memoryKeychain(): KeyStorage {
  return {
    getItem: async (k) => keychain.get(k) ?? null,
    setItem: async (k, v) => void keychain.set(k, v),
    removeItem: async (k) => void keychain.delete(k),
    peek: (k) => keychain.get(k),
  };
}

beforeEach(() => {
  keychain = new Map([[simklLinkName(null), JSON.stringify(link)]]);
  setSimklLinkStorage(memoryKeychain());
  asked = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    asked.push({ path: new URL(url).pathname, body: JSON.parse(String(init.body ?? "{}")) });
    return new Response("{}", { status: 201 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setSimklLinkStorage(undefined);
  localStorage.clear();
});

async function settle(until = () => true) {
  for (let i = 0; i < 300; i++) {
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    if (i >= 4 && until()) return;
  }
}

test("linked: a film's list and rating from their menus, kept at once and sent; taking it off Simkl takes the rating too", async () => {
  const { container, unmount } = await render(<SimklPanel item={film} />);
  await settle();
  await click(byText(container, "button", "Add on Simkl"));
  await settle();
  expect([...document.querySelectorAll("[role=menuitem]")].map((i) => i.textContent)).toEqual(["Plan to Watch", "Completed", "Dropped"]);
  await click(byText(document.body, "[role=menuitem]", "Completed"));
  await settle(() => asked.length >= 1);
  expect(simklItems(null).tt0000001).toEqual({ kind: "movies", status: "completed" });
  expect(byText(container, "button", "Simkl: Completed")).toBeTruthy();
  expect(asked[0]).toMatchObject({ path: "/sync/add-to-list", body: { movies: [{ ids: { imdb: "tt0000001" }, to: "completed" }] } });

  await click(container.querySelector('[aria-label="Rate on Simkl"]'));
  await settle();
  await click(byText(document.body, "[role=menuitem]", "8"));
  await settle(() => asked.length >= 2);
  expect(simklRatings(null)).toEqual({ tt0000001: 8 });
  expect(container.querySelector('[aria-label="Your Simkl rating: 8 of 10"]')?.textContent).toBe("8");
  expect(asked[1]).toMatchObject({ path: "/sync/ratings", body: { movies: [{ ids: { imdb: "tt0000001" }, rating: 8 }] } });

  await click(byText(container, "button", "Simkl: Completed"));
  await settle();
  await click(byText(document.body, "[role=menuitem]", "Remove from Simkl"));
  await settle(() => asked.length >= 4);
  expect(simklItems(null)).toEqual({});
  expect(simklRatings(null)).toEqual({});
  expect(asked.slice(2).map((a) => a.path)).toEqual(["/sync/history/remove", "/sync/ratings/remove"]);
  await unmount();
});

test("a show offers every list; View on Simkl opens its page by Simkl's number", async () => {
  localStorage.setItem(simklItemsKey(null), JSON.stringify({ tt0000002: { kind: "shows", status: "watching", simkl: 7 } }));
  const opened: string[] = [];
  const external = spyOn(api, "openExternal").mockImplementation(async (url) => void opened.push(url));
  const { container, unmount } = await render(<SimklPanel item={{ id: "tt0000002", type: "series" }} />);
  await settle();
  await click(byText(container, "button", "Simkl: Watching"));
  await settle();
  expect([...document.querySelectorAll("[role=menuitem]")].map((i) => i.textContent)).toEqual([
    "Watching",
    "Plan to Watch",
    "On Hold",
    "Completed",
    "Dropped",
    "Remove from Simkl",
  ]);
  await click(byText(container, "button", "View on Simkl"));
  await settle(() => opened.length > 0);
  expect(opened).toEqual(["https://simkl.com/tv/7"]);
  external.mockRestore();
  await unmount();
});

test("not linked, or an episode or a file: nothing", async () => {
  keychain.clear();
  const a = await render(<SimklPanel item={film} />);
  await settle();
  expect(a.container.innerHTML).toBe("");
  await a.unmount();
  keychain.set(simklLinkName(null), JSON.stringify(link));
  const b = await render(<SimklPanel item={{ id: "tt0000002:1:2", type: "series" }} />);
  await settle();
  expect(b.container.innerHTML).toBe("");
  await b.unmount();
});
