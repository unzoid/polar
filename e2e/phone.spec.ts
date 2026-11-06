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
  // The shelves' paging paddles are a mouse thing: on touch they'd catch taps on the cards under them.
  await expect(app.locator(".row-paddle").first()).toBeHidden();
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

test("a sideways swipe on the featured card steps through the titles", async ({ app }) => {
  const dots = app.getByRole("tablist", { name: "Featured" }).getByRole("tab");
  await expect(dots.first()).toHaveAttribute("aria-selected", "true");
  // The arrows give way to the swipe on a phone.
  await expect(app.getByRole("button", { name: "Next featured" })).toBeHidden();
  const swipe = (from: number, to: number) =>
    app.locator(".hero-card").evaluate(
      (el, [from, to]) => {
        const r = el.getBoundingClientRect();
        const y = r.top + r.height / 2;
        const at = (type: string, x: number) =>
          el.dispatchEvent(new PointerEvent(type, { pointerType: "touch", isPrimary: true, pointerId: 7, clientX: x, clientY: y, bubbles: true }));
        at("pointerdown", r.left + r.width * from);
        at("pointerup", r.left + r.width * to);
      },
      [from, to],
    );
  await swipe(0.8, 0.2);
  await expect(dots.nth(1)).toHaveAttribute("aria-selected", "true");
  await swipe(0.2, 0.8);
  await expect(dots.first()).toHaveAttribute("aria-selected", "true");
  // Still on Home: the swipe didn't open the title.
  await expect(app.getByRole("tablist", { name: "Featured" })).toBeVisible();
});

test("a title page's action row fits a phone", async ({ app }) => {
  const tabs = app.getByRole("navigation", { name: "Primary" });
  await tabs.getByRole("button", { name: "Series", exact: true }).tap();
  await card(app, "Kingsbridge").tap();
  const download = app.locator(".detail-actions").getByRole("button").last();
  await expect(download).toBeVisible();
  const box = await download.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(app.viewportSize()!.width);
});

test("on touch, an episode's Sources and Download buttons are always there, in the quiet style (#79)", async ({ app }) => {
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Series", exact: true }).tap();
  await card(app, "Fieldwork").tap();
  const ep = app.locator(".episode-card:has(.episode-card-main:not([disabled]))").first();
  await expect(ep).toBeVisible();
  for (const sel of [".episode-sources", ".episode-download"]) {
    await expect(ep.locator(sel)).toBeVisible();
    expect(await ep.locator(sel).evaluate((b) => getComputedStyle(b).opacity)).toBe("1");
  }
});

test("a phone has no TV mode (#141)", async ({ app }) => {
  await expect(app.getByRole("button", { name: "TV mode" })).toHaveCount(0);
});

test("the season picker keeps its own row on a phone (#151)", async ({ app }) => {
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Series", exact: true }).tap();
  await card(app, "Kingsbridge").tap();
  const picker = app.locator(".seasons-picker");
  await expect(picker).toBeVisible();
  const box = await picker.boundingBox();
  // The whole bar's width, not squeezed beside Download Season and the layout switch.
  expect(box!.width).toBeGreaterThan(app.viewportSize()!.width * 0.8);
  expect(await fitsWidth(app)).toBe(true);
});

test("settings on a phone: the sections, then one section with a way back", async ({ app }) => {
  await app.getByRole("button", { name: /^Profile/ }).tap();
  await app.getByRole("menuitem", { name: "Settings" }).tap();
  // Not by name: on a phone the header shows only the open section, and that names the dialog ("Browsing").
  const settings = app.getByRole("dialog");
  await expect(settings).toHaveAccessibleName(/^Settings/);
  const browsing = settings.getByRole("button", { name: "Browsing", exact: true });
  await expect(browsing).toBeVisible();
  await browsing.tap();
  await expect(settings.getByRole("switch", { name: /^Show the Calendar/ })).toBeVisible();
  await expect(settings).toHaveAccessibleName("Browsing");
  await expect(browsing).toBeHidden();
  await settings.getByRole("button", { name: "All settings" }).tap();
  await expect(browsing).toBeVisible();
  await settings.getByRole("button", { name: "Close settings" }).tap();
  await expect(settings).toHaveCount(0);
});
