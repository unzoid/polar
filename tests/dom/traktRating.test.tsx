import { afterEach, beforeEach, expect, test } from "bun:test";
import { act } from "react";
import { TraktNotSent, TraktRating } from "../../src/components/title/TraktRating";
import type { KeyStorage } from "../../src/lib/platform/keychain";
import { setTraktLinkStorage, traktLinkName, type TraktLink } from "../../src/lib/trakt/link";
import { traktRatings } from "../../src/lib/trakt/ratings";
import type { MetaPreview } from "../../src/lib/types";
import { byText, click, render } from "./render";

// #85: a linked profile rates a film or show 1–10 on its title page.
const link: TraktLink = { token: "TOKEN", refreshToken: "REFRESH", expiresAt: Date.now() + 6 * 86_400_000, slug: "someone", name: "Someone" };
const film = { id: "tt0000001", type: "movie", name: "Night Train" } as MetaPreview;
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
  keychain = new Map([[traktLinkName(null), JSON.stringify(link)]]);
  setTraktLinkStorage(memoryKeychain());
  asked = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    asked.push({ path: url.replace("https://api.trakt.tv", ""), body: JSON.parse(String(init.body ?? "{}")) });
    return new Response("{}", { status: 201 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setTraktLinkStorage(undefined);
  localStorage.clear();
});

async function settle(until = () => true) {
  for (let i = 0; i < 300; i++) {
    await act(async () => new Promise((r) => setTimeout(r, 10)));
    if (i >= 4 && until()) return;
  }
}

test("linked: rate from the menu, kept at once and sent; the rating can be taken off again", async () => {
  const { container, unmount } = await render(<TraktRating item={film} />);
  await settle();
  await click(container.querySelector('[aria-label="Rate on Trakt"]'));
  await settle();
  const items = [...document.querySelectorAll("[role=menuitem]")].map((i) => i.textContent);
  expect(items).toEqual(["10", "9", "8", "7", "6", "5", "4", "3", "2", "1"]);
  await click(byText(document.body, "[role=menuitem]", "8"));
  await settle(() => asked.length >= 1);
  expect(traktRatings(null)).toEqual({ tt0000001: 8 });
  expect(container.querySelector('[aria-label="Your Trakt rating: 8 of 10"]')?.textContent).toBe("8");
  expect(asked[0].path).toBe("/sync/ratings");
  expect(asked[0].body).toMatchObject({ movies: [{ ids: { imdb: "tt0000001" }, rating: 8 }] });
  await click(container.querySelector('[aria-label="Your Trakt rating: 8 of 10"]'));
  await settle();
  await click(byText(document.body, "[role=menuitem]", "Remove Rating"));
  await settle(() => asked.length >= 2);
  expect(traktRatings(null)).toEqual({});
  expect(asked[1].path).toBe("/sync/ratings/remove");
  await unmount();
});

test("not linked, or a title Trakt can't be told about: no rating control", async () => {
  keychain.clear();
  const a = await render(<TraktRating item={film} />);
  await settle();
  expect(a.container.innerHTML).toBe("");
  await a.unmount();
  keychain.set(traktLinkName(null), JSON.stringify(link));
  const b = await render(<TraktRating item={{ ...film, id: "kitsu:5", type: "series" } as MetaPreview} />);
  await settle();
  expect(b.container.innerHTML).toBe("");
  await b.unmount();
});

test("an anime played from Kitsu says it isn't sent to Trakt, only while Trakt is linked", async () => {
  const a = await render(<TraktNotSent id="kitsu:5" />);
  await settle();
  expect(a.container.textContent).toContain("Not sent to Trakt");
  await a.unmount();
  const b = await render(<TraktNotSent id="tt0000002" />);
  await settle();
  expect(b.container.innerHTML).toBe("");
  await b.unmount();
  keychain.clear();
  const c = await render(<TraktNotSent id="kitsu:5" />);
  await settle();
  expect(c.container.innerHTML).toBe("");
  await c.unmount();
});
