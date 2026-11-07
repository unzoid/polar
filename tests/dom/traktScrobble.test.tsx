import { afterEach, beforeEach, expect, test } from "bun:test";
import { act, useRef } from "react";
import type { MediaLike } from "../../src/components/player/mpvMedia";
import { useTraktScrobble } from "../../src/components/player/useTraktScrobble";
import type { KeyStorage } from "../../src/lib/platform/keychain";
import { setTraktLinkStorage, traktLinkName, type TraktLink } from "../../src/lib/trakt/link";
import { pendingTraktOps } from "../../src/lib/trakt/queue";
import { render } from "./render";

// #85: the player tells a linked Trakt account what plays.
const link: TraktLink = { token: "TOKEN", refreshToken: "REFRESH", expiresAt: Date.now() + 6 * 86_400_000, slug: "someone", name: "Someone" };
const realFetch = globalThis.fetch;
let keychain: Map<string, string>;
let asked: { path: string; body: { progress?: number } }[] = [];
let failStops = false;

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
  failStops = false;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const path = url.replace("https://api.trakt.tv", "");
    asked.push({ path, body: JSON.parse(String(init.body ?? "{}")) });
    if (failStops && path === "/scrobble/stop") throw new TypeError("network");
    return new Response("{}", { status: 201 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setTraktLinkStorage(undefined);
  localStorage.clear();
});

const media = { currentTime: 0, duration: 1000, ended: false } as unknown as MediaLike & { currentTime: number };

function Player({ videoId, playing, enabled = true }: { videoId: string; playing: boolean; enabled?: boolean }) {
  const ref = useRef<MediaLike | null>(media);
  useTraktScrobble({ media: ref, videoId, type: "series", playing, enabled });
  return null;
}

/** Scrobbles keep to Trakt's one write a second: waits until `n` went out. */
async function sent(n: number) {
  for (let i = 0; i < 300 && asked.length < n; i++) await act(async () => new Promise((r) => setTimeout(r, 10)));
}

async function settle() {
  for (let i = 0; i < 5; i++) await act(async () => new Promise((r) => setTimeout(r, 10)));
}

test("start, pause and resume as it plays; the stop on the next episode is the old one's, counted watched by Trakt", async () => {
  media.currentTime = 100;
  const view = await render(<Player videoId="tt0000002:1:1" playing={false} />);
  await settle();
  expect(asked).toEqual([]);
  await view.rerender(<Player videoId="tt0000002:1:1" playing />);
  await sent(1);
  media.currentTime = 500;
  await view.rerender(<Player videoId="tt0000002:1:1" playing={false} />);
  await sent(2);
  media.currentTime = 950;
  await view.rerender(<Player videoId="tt0000002:1:2" playing />);
  await sent(4);
  await settle();
  expect(asked.map((a) => [a.path, a.body.progress])).toEqual([
    ["/scrobble/start", 10],
    ["/scrobble/pause", 50],
    ["/scrobble/stop", 95],
    ["/scrobble/start", 95],
  ]);
  expect(asked[2].body).toMatchObject({ show: { ids: { imdb: "tt0000002" } }, episode: { season: 1, number: 1 } });
  expect(asked[3].body).toMatchObject({ episode: { season: 1, number: 2 } });
  // Trakt counted the stop: nothing more for the history.
  expect(pendingTraktOps(null)).toEqual([]);
  await view.unmount();
  await sent(5);
  expect(asked[4]).toMatchObject({ path: "/scrobble/stop", body: { episode: { number: 2 } } });
});

test("a stop that can't go out leaves a watched episode in the history queue", async () => {
  failStops = true;
  media.currentTime = 10;
  const view = await render(<Player videoId="tt0000002:1:1" playing />);
  await sent(1);
  media.currentTime = 990;
  await view.unmount();
  await sent(2);
  for (let i = 0; i < 300 && !pendingTraktOps(null).length; i++) await settle();
  expect(pendingTraktOps(null)).toMatchObject([{ list: "history", ref: { kind: "episode", imdb: "tt0000002", season: 1, number: 1 } }]);
});

test("opened and closed unplayed sends nothing; files and Kitsu anime never do", async () => {
  const unplayed = await render(<Player videoId="tt0000002:1:1" playing={false} />);
  await unplayed.unmount();
  const file = await render(<Player videoId="tt0000002:1:1" playing enabled={false} />);
  await file.unmount();
  const kitsu = await render(<Player videoId="kitsu:5:1" playing />);
  await kitsu.unmount();
  await settle();
  expect(asked).toEqual([]);
});
