import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { LinkConfirm } from "../../src/components/party/LinkConfirm";
import { usePlayerKeyboard } from "../../src/components/player/usePlayerKeyboard";
import { LinkForm } from "../../src/components/party/PartyUI";
import { TogetherOffer } from "../../src/components/party/TogetherOffer";
import { dismissTogether, getParty, getPartySurface, leaveParty, linkId, offerTogether } from "../../src/lib/party";
import { byText, click, press, render } from "./render";

// Watching a pasted link together (#136).

const settle = (ms = 20) => act(async () => new Promise((r) => setTimeout(r, ms)));
const FILM = "https://media.example.com/films/open-film.mp4";

// The native side's link check: a page for .html, a video otherwise.
const checked: string[] = [];
(window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {
  invoke: async (cmd: string, args: { url: string }) => {
    if (cmd !== "stream_ready") return null;
    checked.push(args.url);
    return args.url.endsWith(".html") ? { state: "notReady", reason: "Answered with a page, not a video" } : { state: "ready", ms: 40 };
  },
};
afterEach(() => {
  checked.length = 0;
  leaveParty();
  dismissTogether();
});

async function typeLink(container: HTMLElement, text: string) {
  const input = container.querySelector<HTMLInputElement>("input[aria-label='Video link']")!;
  await act(async () => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    set.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(byText(container, "button", "Watch"));
  await settle();
}

test("the link is shown in full, with who sent it, before it plays; Escape is Not Now", async () => {
  const played: string[] = [];
  const { unmount } = await render(<LinkConfirm url={FILM} from="Robin" onPlay={() => played.push("play")} onLater={() => played.push("later")} />);
  expect(document.body.textContent).toContain("Robin put on a link");
  expect(document.querySelector("[data-testid='party-link-url']")!.textContent).toBe(FILM);
  await press("Escape");
  expect(played).toEqual(["later"]);
  await click(byText(document.body, "button", "Play"));
  expect(played).toEqual(["later", "play"]);
  await unmount();
});

test("over the player, the question's keys are its own: Space presses its button, not the player's play/pause", async () => {
  const actions: string[] = [];
  function PlayerKeys() {
    usePlayerKeyboard(true, (a) => (actions.push(a), true), () => {});
    return null;
  }
  const { unmount } = await render(
    <>
      <PlayerKeys />
      <LinkConfirm url={FILM} onPlay={() => {}} onLater={() => {}} />
    </>,
  );
  expect(document.body.textContent).toContain("The party put on a link");
  await press(" ", byText(document.body, "button", "Play"));
  expect(actions).toEqual([]);
  await press(" ", document.body);
  expect(actions).toEqual(["playPause"]);
  await unmount();
});

test("a web page is turned down with a clear reason; a video link starts the party on it", async () => {
  let done = 0;
  const { container, unmount } = await render(<LinkForm me={{ name: "Sam", avatar: "a1" }} onDone={() => done++} />);

  await typeLink(container, "media.example.com/film.mp4");
  expect(container.textContent).toContain("Links start with https://");
  expect(checked).toEqual([]);

  await typeLink(container, "https://media.example.com/watch.html");
  expect(container.textContent).toContain("That page isn't a video Polarity can play");
  expect(getParty()).toBeNull();
  expect(done).toBe(0);

  await typeLink(container, FILM);
  expect(checked.at(-1)).toBe(FILM);
  expect(getParty()?.playback?.media).toMatchObject({ videoId: linkId(FILM), url: FILM });
  expect(done).toBe(1);
  await unmount();
});

test("a YouTube video's link starts the party on its one address, with no file to check (#201)", async () => {
  const { container, unmount } = await render(<LinkForm me={{ name: "Sam", avatar: "a1" }} />);
  const url = "https://www.youtube.com/watch?v=abc-DEF_123";
  await typeLink(container, "https://youtu.be/abc-DEF_123?si=xxx");
  expect(checked).toEqual([]);
  expect(getParty()?.playback?.media).toMatchObject({ videoId: linkId(url), url, label: "YouTube video" });
  await unmount();
});

// Watching together from the browser extension (#208): a polarity://together link only asks.

const SAM = { name: "Sam", avatar: "a1" };

test("a watch-together link shows the link, the page's title and the start, and starts nothing until asked", async () => {
  const { unmount } = await render(<TogetherOffer />);
  await act(async () => offerTogether({ url: FILM, at: 75, name: "An open film" }, SAM));
  expect(document.body.textContent).toContain("Watch together?");
  expect(document.querySelector("[data-testid='party-link-url']")!.textContent).toBe(FILM);
  expect(document.querySelector("[data-testid='party-together-name']")!.textContent).toBe("“An open film”");
  expect(document.body.textContent).toContain("It starts at 1:15");
  expect(getPartySurface()).toBe("together");
  expect(getParty()).toBeNull();
  expect(checked).toEqual([]);

  await press("Escape");
  expect(document.body.textContent).not.toContain("Watch together?");
  expect(getParty()).toBeNull();

  await act(async () => offerTogether({ url: FILM, at: 75 }, SAM));
  // Another link arriving while this one is asked doesn't take its place.
  await act(async () => offerTogether({ url: "https://media.example.com/other.mp4", at: 0 }, SAM));
  expect(document.querySelector("[data-testid='party-link-url']")!.textContent).toBe(FILM);
  await click(byText(document.body, "button", "Watch Together"));
  await settle();
  expect(checked).toEqual([FILM]);
  expect(getParty()?.playback).toMatchObject({ media: { videoId: linkId(FILM), url: FILM }, position: 75, paused: false });
  expect(document.body.textContent).not.toContain("Watch together?");
  expect(getPartySurface()).toBeNull();
  await unmount();
});

test("a watch-together link to a page says why on the card; signed out it doesn't offer to start", async () => {
  const { unmount } = await render(<TogetherOffer />);
  await act(async () => offerTogether({ url: "https://media.example.com/watch.html", at: 0 }, SAM));
  await click(byText(document.body, "button", "Watch Together"));
  await settle();
  expect(document.querySelector("[role='alert']")!.textContent).toContain("That page isn't a video Polarity can play");
  expect(getParty()).toBeNull();
  await click(byText(document.body, "button", "OK"));
  expect(document.body.textContent).not.toContain("Couldn't watch together");

  await act(async () => offerTogether({ url: FILM, at: 0 }, null));
  expect(document.body.textContent).toContain("Sign in to Polarity to watch together.");
  expect([...document.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["OK"]);
  await unmount();
});

test("in a party, a watch-together link puts the video on for everyone once asked", async () => {
  const { container, unmount } = await render(
    <>
      <LinkForm me={SAM} />
      <TogetherOffer />
    </>,
  );
  await typeLink(container, FILM);
  await act(async () => offerTogether({ url: "https://www.youtube.com/watch?v=abc-DEF_123", at: 30 }, SAM));
  expect(document.body.textContent).toContain("put this on for everyone in your party");
  await click(byText(document.body, "button", "Watch Together"));
  await settle();
  expect(getParty()?.playback?.media.url).toBe("https://www.youtube.com/watch?v=abc-DEF_123");
  await unmount();
});
