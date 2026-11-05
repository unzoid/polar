import { expect, test } from "bun:test";
import { pressEscape } from "../../src/lib/ui/systemBack";
import { installKeepFieldInView } from "../../src/lib/ui/keyboard";
import { dismissDepth, pushDismiss } from "../../src/lib/ui/dismiss";

const keys = (el: EventTarget) => {
  const seen: string[] = [];
  el.addEventListener("keydown", (e) => seen.push((e as KeyboardEvent).key));
  return seen;
};

test("pressEscape lands on what has focus and bubbles to the window", () => {
  const button = document.createElement("button");
  document.body.append(button);
  button.focus();
  const onButton = keys(button);
  const onWindow = keys(window);
  pressEscape();
  expect(onButton).toEqual(["Escape"]);
  expect(onWindow).toEqual(["Escape"]);
  button.remove();
});

test("pressEscape leaves a text field first, so Back reaches the page", () => {
  const input = document.createElement("input");
  document.body.append(input);
  input.focus();
  const onInput = keys(input);
  const onBody = keys(document.body);
  pressEscape();
  expect(onInput).toEqual([]);
  expect(onBody).toEqual(["Escape"]);
  expect(document.activeElement).not.toBe(input);
  input.remove();
});

test("pressEscape closes the topmost layer and stops there", () => {
  let closed = 0;
  const off = pushDismiss(() => closed++);
  const onWindow = keys(window);
  pressEscape();
  expect(closed).toBe(1);
  expect(onWindow).toEqual([]);
  off();
  expect(dismissDepth()).toBe(0);
});

test("a resize while a text field has focus scrolls it into view, only where there is an on-screen keyboard", async () => {
  const input = document.createElement("input");
  document.body.append(input);
  input.focus();
  let scrolled = 0;
  input.scrollIntoView = () => void scrolled++;
  const offDesktop = installKeepFieldInView(window, false);
  window.dispatchEvent(new Event("resize"));
  offDesktop();
  const off = installKeepFieldInView(window, true);
  window.dispatchEvent(new Event("resize"));
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  expect(scrolled).toBe(1);
  input.blur();
  window.dispatchEvent(new Event("resize"));
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  expect(scrolled).toBe(1);
  off();
  input.remove();
});
