import { expect, test } from "bun:test";
import { systemBackAction } from "../src/lib/ui/systemBack";

test("Android Back: an open layer or a pushed page goes back as Escape does", () => {
  expect(systemBackAction({ open: true, pushed: 0, atHome: true })).toBe("escape");
  expect(systemBackAction({ open: false, pushed: 2, atHome: false })).toBe("escape");
  expect(systemBackAction({ open: true, pushed: 1, atHome: false })).toBe("escape");
});

test("Android Back at a tab's own page: another tab goes Home, Home closes the app", () => {
  expect(systemBackAction({ open: false, pushed: 0, atHome: false })).toBe("home");
  expect(systemBackAction({ open: false, pushed: 0, atHome: true })).toBe("leave");
});
