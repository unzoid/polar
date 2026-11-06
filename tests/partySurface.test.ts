// One watch party surface at a time (#247): opening one closes the one that was up.
import { expect, test } from "bun:test";
import { closePartySurface, getPartySurface, onPartySurface, openPartySurface, setJoinPartyOpen, setPartyMenuOpen } from "../src/lib/party/surface";

test("opening a surface replaces the one that was up, and closing another leaves it", () => {
  setJoinPartyOpen(true);
  expect(getPartySurface()).toBe("join");
  openPartySurface("panel");
  expect(getPartySurface()).toBe("panel");
  // The join dialog's own close, arriving late, doesn't take the panel down.
  setJoinPartyOpen(false);
  expect(getPartySurface()).toBe("panel");
  openPartySurface("link");
  closePartySurface("panel");
  expect(getPartySurface()).toBe("link");
  closePartySurface("link");
  expect(getPartySurface()).toBeNull();
});

test("listeners hear each change once, and nothing when it stays the same", () => {
  let heard = 0;
  const stop = onPartySurface(() => heard++);
  setPartyMenuOpen(true);
  setPartyMenuOpen(true);
  setPartyMenuOpen(false);
  setPartyMenuOpen(false);
  stop();
  setPartyMenuOpen(true);
  setPartyMenuOpen(false);
  expect(heard).toBe(2);
});
