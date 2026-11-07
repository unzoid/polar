import { expect, mock, test } from "bun:test";
import { act, useRef, useState } from "react";
import { render } from "./render";
import * as platform from "../../src/lib/platform";
import type { NativeBackState } from "../../src/lib/platform";

// As in the iOS shell: the system's back button stands in for the web app's (ios/back.m).
const sent: NativeBackState[] = [];
let press: ((steps: number) => void) | undefined;
mock.module("../../src/lib/platform", () => ({
  ...platform,
  nativeBackAvailable: true,
  setNativeBack: async (state: NativeBackState) => void sent.push(state),
  onNativeBack: async (handler: (steps: number) => void) => ((press = handler), () => {}),
}));
const { useNativeBack } = await import("../../src/components/NativeBack");

function Page({ shown, onBack }: { shown: boolean; onBack: (steps: number) => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const native = useNativeBack(ref, shown, ["Movies", "Home"], onBack);
  return <button ref={ref} data-native-back={native || undefined} aria-label="Back" />;
}

test("iOS draws Back where the web app's stands, hides it while covered, and goes back as far as picked (#174)", async () => {
  const steps: number[] = [];
  const box = { x: 12, y: 30, width: 40, height: 40 };
  const view = await render(<Page shown onBack={(n) => steps.push(n)} />);
  const button = view.container.querySelector("button")!;
  button.getBoundingClientRect = () => ({ ...box, top: 30, left: 12, right: 52, bottom: 70, toJSON: () => box }) as DOMRect;
  await view.rerender(<Page shown={false} onBack={(n) => steps.push(n)} />);
  await view.rerender(<Page shown onBack={(n) => steps.push(n)} />);
  expect(button.dataset.nativeBack).toBe("true");
  expect(sent.at(-1)).toEqual({ shown: true, rect: box, history: ["Movies", "Home"] });

  await act(async () => press?.(2));
  expect(steps).toEqual([2]);

  await view.rerender(<Page shown={false} onBack={(n) => steps.push(n)} />);
  expect(button.dataset.nativeBack).toBeUndefined();
  expect(sent.at(-1)?.shown).toBe(false);
  await view.unmount();
});

test("the last Back to show wins: Settings' over the top bar's, and the top bar's again once it's gone", async () => {
  function Two() {
    const [settings, setSettings] = useState(true);
    const a = useRef<HTMLButtonElement>(null);
    const b = useRef<HTMLButtonElement>(null);
    useNativeBack(a, true, ["Home"], () => {});
    useNativeBack(b, settings, ["Settings"], () => setSettings(false));
    for (const [ref, x] of [[a, 1], [b, 2]] as const)
      if (ref.current) ref.current.getBoundingClientRect = () => ({ x, y: 0, width: 40, height: 40 }) as DOMRect;
    return (
      <>
        <button ref={a} />
        <button ref={b} />
      </>
    );
  }
  const view = await render(<Two />);
  await view.rerender(<Two />);
  await act(async () => window.dispatchEvent(new Event("resize")));
  expect(sent.at(-1)?.history).toEqual(["Settings"]);
  await act(async () => press?.(1));
  expect(sent.at(-1)?.history).toEqual(["Home"]);
  await view.unmount();
});
