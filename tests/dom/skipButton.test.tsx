import { afterEach, expect, jest, test } from "bun:test";
import { act } from "react";
import { SKIP_ALONE_MS, SkipButton, type ActiveSkip } from "../../src/components/player/SkipSegments";
import { render } from "./render";

const tick = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));
const intro: ActiveSkip = { kind: "intro", label: "Skip Intro", span: { start: 10, end: 90 } };
const recap: ActiveSkip = { kind: "recap", label: "Skip Recap", span: { start: 0, end: 9 } };

afterEach(() => jest.useRealTimers());

const shown = (c: HTMLElement) => c.querySelector(".skip-button")!.getAttribute("data-visible");

test("#17: the skip button shows when the segment starts, then hides with the controls", async () => {
  jest.useFakeTimers();
  const { container, rerender, unmount } = await render(<SkipButton active={intro} onSkip={() => {}} chromeVisible={false} />);
  expect(shown(container)).toBe("true");
  await tick(SKIP_ALONE_MS - 100);
  expect(shown(container)).toBe("true");
  await tick(200);
  expect(shown(container)).toBe("false");
  expect(container.querySelector<HTMLButtonElement>(".skip-button")!.tabIndex).toBe(-1);
  // The controller's skip button still skips while it's hidden (tv/gamepad.ts reads this).
  expect(container.querySelector(".skip-button")!.getAttribute("data-segment")).toBe("true");

  // The controls coming back bring it back; it leaves again with them.
  await rerender(<SkipButton active={intro} onSkip={() => {}} chromeVisible />);
  expect(shown(container)).toBe("true");
  await rerender(<SkipButton active={intro} onSkip={() => {}} chromeVisible={false} />);
  expect(shown(container)).toBe("false");

  // The next segment shows on its own again.
  await rerender(<SkipButton active={recap} onSkip={() => {}} chromeVisible={false} />);
  expect(shown(container)).toBe("true");
  expect(container.textContent).toContain("Skip Recap");
  await unmount();
});

test("#17: with the controls up the whole time, it stays", async () => {
  jest.useFakeTimers();
  const { container, unmount } = await render(<SkipButton active={intro} onSkip={() => {}} chromeVisible />);
  await tick(SKIP_ALONE_MS * 3);
  expect(shown(container)).toBe("true");
  await unmount();
});

test("#17: no segment, no button", async () => {
  const { container, unmount } = await render(<SkipButton active={null} onSkip={() => {}} chromeVisible />);
  expect(shown(container)).toBe("false");
  expect(container.querySelector(".skip-button")!.getAttribute("data-segment")).toBe("false");
  await unmount();
});
