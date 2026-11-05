import type { Page } from "@playwright/test";
import { card, expect, test } from "./fixtures";

// Phone width (Pixel 7: 412×915, touch). The same components as desktop in the phone layout (docs/ARCHITECTURE.md §4).

/** Nothing sticks out sideways: the page never scrolls horizontally. */
const fitsWidth = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test("the phone layout: tab bar at the bottom, no window buttons", async ({ app }) => {
  await expect(app.locator("html")).toHaveAttribute("data-form", "phone");
  await expect(app.locator("html")).toHaveAttribute("data-touch", "true");
  const tabs = app.getByRole("navigation", { name: "Primary" });
  const box = await tabs.boundingBox();
  const height = app.viewportSize()!.height;
  expect(box!.y + box!.height).toBeGreaterThan(height - 120);
  await expect(app.getByRole("button", { name: "Minimize" })).toHaveCount(0);
  expect(await fitsWidth(app)).toBe(true);
});

test("tabs, a title page and the player by touch", async ({ app }) => {
  const tabs = app.getByRole("navigation", { name: "Primary" });
  await tabs.getByRole("button", { name: "Series", exact: true }).tap();
  await expect(app.getByRole("heading", { level: 1, name: "Series" })).toBeVisible();
  expect(await fitsWidth(app)).toBe(true);

  await tabs.getByRole("button", { name: "Movies", exact: true }).tap();
  await card(app, "The Glass Orchard").tap();
  await expect(app.getByRole("heading", { level: 1, name: "The Glass Orchard" })).toBeVisible();
  expect(await fitsWidth(app)).toBe(true);

  await app.getByRole("button", { name: "Play", exact: true }).tap();
  const player = app.locator(".player");
  await expect(player).toHaveAttribute("data-started", "true");
  // The controls hide while it plays; a tap on the picture brings them back, a second one hides them.
  await expect(player).toHaveAttribute("data-chrome", "false");
  await player.tap({ position: { x: 200, y: 300 } });
  await expect(player).toHaveAttribute("data-chrome", "true");
  await player.tap({ position: { x: 200, y: 300 } });
  await expect(player).toHaveAttribute("data-chrome", "false");
  await player.tap({ position: { x: 200, y: 300 } });
  await player.getByRole("button", { name: "Back", exact: true }).tap();
  await expect(player).toHaveCount(0);
});

test("search on a phone", async ({ app }) => {
  await app.getByRole("button", { name: "Search", exact: true }).tap();
  await app.getByRole("textbox", { name: "Search" }).fill("orchard");
  await expect(card(app, "Orchard House")).toBeVisible();
  expect(await fitsWidth(app)).toBe(true);
});
