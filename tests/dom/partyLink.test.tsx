import { afterEach, expect, test } from "bun:test";
import { act } from "react";
import { LinkConfirm } from "../../src/components/party/LinkConfirm";
import { usePlayerKeyboard } from "../../src/components/player/usePlayerKeyboard";
import { LinkForm } from "../../src/components/party/PartyUI";
import { getParty, leaveParty, linkId } from "../../src/lib/party";
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
  expect(container.textContent).toContain("That's a web page, not a video");
  expect(getParty()).toBeNull();
  expect(done).toBe(0);

  await typeLink(container, FILM);
  expect(checked.at(-1)).toBe(FILM);
  expect(getParty()?.playback?.media).toMatchObject({ videoId: linkId(FILM), url: FILM });
  expect(done).toBe(1);
  await unmount();
});
