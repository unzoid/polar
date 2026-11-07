import { expect, test } from "bun:test";
import { act } from "react";
import { PlayerStatus } from "../../src/components/player/PlayerStatus";
import type { StartStep } from "../../src/lib/playback";
import { byText, click, render } from "./render";

const steps: StartStep[] = [
  { at: 0, text: "Asking 2 add-ons for sources", tone: "info", stage: "sources" },
  { at: 400, text: "Open Films: 3 sources", tone: "ok", stage: "sources" },
  { at: 650, text: "Contacting cdn.example.com", tone: "info", stage: "server" },
  { at: 900, text: "302: sent on from cdn.example.com to edge.example.net (120 ms)", tone: "info", stage: "server" },
  { at: 1500, text: "edge.example.net answered 403 Forbidden", tone: "fail", stage: "server" },
  { at: 1600, text: "Not trying another source: the list is empty", tone: "warn" },
];

const noop = () => {};

test("while loading: the stage message and the last five steps, nothing to press", async () => {
  const { container } = await render(<PlayerStatus state={{ status: "searching" }} error={null} name="Sintel" steps={steps} backend="mpv" onSources={noop} />);
  expect(container.querySelector("[role=status]")!.textContent).toBe("Finding the best source");
  const lines = container.querySelectorAll(".player-steps li");
  expect(lines.length).toBe(5);
  expect(lines[0].textContent).toContain("Open Films: 3 sources");
  expect(lines[4].getAttribute("data-current")).toBe("true");
  expect(container.querySelector(".player-status-where")).toBeNull();
  expect(container.querySelectorAll("button").length).toBe(0);
});

test("failed: says where it failed, shows the whole log, focuses Choose Another Source", async () => {
  let picked = 0;
  const { container } = await render(
    <PlayerStatus
      state={{ status: "failed", reason: "The server refused the link (403)." }}
      error={null}
      name="Sintel"
      steps={steps}
      backend="mpv"
      onSources={() => picked++}
    />,
  );
  expect(container.querySelector("[role=status]")!.textContent).toBe("The server refused the link (403).");
  expect(container.querySelector(".player-status-where")!.textContent).toBe("Failed at the source's server");
  expect(container.querySelectorAll(".player-steps li").length).toBe(steps.length);
  const choose = byText(container, "button", "Choose Another Source");
  expect(document.activeElement).toBe(choose);
  await click(choose);
  expect(picked).toBe(1);
});

test("Copy Details puts the redacted report on the clipboard and says so", async () => {
  let copied = "";
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: async (text: string) => void (copied = text) },
  });
  const failed = [
    ...steps,
    { at: 1700, text: "Stopped at https://edge.example.net/v/abc123/film.mkv?token=secret", tone: "fail" as const, stage: "player" as const },
  ];
  const { container } = await render(
    <PlayerStatus state={{ status: "failed", reason: "No source played." }} error={null} name="Sintel" steps={failed} backend="mpv" onSources={noop} />,
  );
  await click(byText(container, "button", "Copy Details"));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  expect(copied.split("\n")[0]).toMatch(/^Polarity dev · .+ · player: mpv$/);
  expect(copied).toContain("Result: No source played. (at the player)");
  expect(copied).toContain("✗ edge.example.net answered 403 Forbidden");
  expect(copied).not.toContain("token=secret");
  expect(copied).not.toContain("abc123");
  expect(byText(container, "button", "Copied")).toBeTruthy();
});

test("a copy the system refuses says it couldn't", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: () => Promise.reject(new Error("denied")) },
  });
  const { container } = await render(<PlayerStatus state={{ status: "failed", reason: "x" }} error={null} steps={steps} backend="video" onSources={noop} />);
  await click(byText(container, "button", "Copy Details"));
  await act(async () => new Promise((r) => setTimeout(r, 0)));
  expect(byText(container, "button", "Couldn't copy")).toBeTruthy();
});

test("a YouTube video that can't play here (Android) says so and offers Open in YouTube (#201)", async () => {
  let opened = 0;
  const { container } = await render(
    <PlayerStatus
      state={{ status: "searching" }}
      error="On Android, YouTube videos play in YouTube."
      name="YouTube video"
      steps={[]}
      backend="YouTube's embedded player"
      onYouTube={() => opened++}
    />,
  );
  expect(container.querySelector("[role=status]")!.textContent).toBe("On Android, YouTube videos play in YouTube.");
  const open = byText(container, "button", "Open in YouTube");
  expect(document.activeElement).toBe(open);
  await click(open);
  expect(opened).toBe(1);
});
