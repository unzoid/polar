import { afterEach, expect, jest, test } from "bun:test";
import { QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { SAVE_FAILURE_MS, StoreProblemToast, TOAST_OUT_MS } from "../../src/components/StoreProblemToast";
import { storeLocal } from "../../src/lib/errors";
import { keys, queryClient } from "../../src/lib/net";
import { render } from "./render";

const refuse = {
  setItem: () => {
    throw new Error("disk full");
  },
};
const fail = () => act(async () => void storeLocal("k", "v", refuse));
const tick = (ms: number) => act(async () => void jest.advanceTimersByTime(ms));

afterEach(() => jest.useRealTimers());

async function mount() {
  queryClient.setQueryData(keys.storeProblem, null);
  return render(
    <QueryClientProvider client={queryClient}>
      <StoreProblemToast tv={false} />
    </QueryClientProvider>,
  );
}

test("a save-failed toast fades out instead of vanishing (re-test 3a)", async () => {
  jest.useFakeTimers();
  const { container, unmount } = await mount();
  await fail();
  const toast = container.querySelector(".toast")!;
  expect(toast.textContent).toContain("disk full");
  expect(toast.hasAttribute("data-leaving")).toBe(false);
  await tick(SAVE_FAILURE_MS);
  expect(container.querySelector(".toast")?.hasAttribute("data-leaving")).toBe(true);
  await tick(TOAST_OUT_MS);
  expect(container.querySelector(".toast")).toBeNull();
  await unmount();
});

test("the same failure again starts the time-out over (re-test 3b)", async () => {
  jest.useFakeTimers();
  const { container, unmount } = await mount();
  await fail();
  await tick(SAVE_FAILURE_MS - 1000);
  await fail();
  await tick(2000);
  const toast = container.querySelector(".toast");
  expect(toast).not.toBeNull();
  expect(toast!.hasAttribute("data-leaving")).toBe(false);
  await unmount();
});

test("it sits in its own layer above Settings (re-test 3d)", async () => {
  const { container, unmount } = await mount();
  await fail();
  expect(container.querySelector(".toast")!.classList.contains("store-toast")).toBe(true);
  await unmount();
});
