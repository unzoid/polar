import type { Page } from "@playwright/test";
import { card, expect, partySurfaces, test } from "./fixtures";

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

test("an add-on's catalogs switched on show as Home rows and fit a phone (#206)", async ({ app }) => {
  await app.addInitScript(() =>
    localStorage.setItem("polar.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("polar.prefs") ?? "{}"), addonCatalogsHome: '{"on":["example.lists"],"order":[]}' })),
  );
  await app.reload();
  const picks = app.locator('[data-addon-row="picks"]');
  await expect(picks.getByRole("button", { name: "Staff Picks · Example Lists" })).toBeVisible();
  await expect(picks.locator(".card")).toHaveCount(4);
  await picks.locator(".card").first().tap();
  await expect(app.getByRole("heading", { level: 1 })).toBeVisible();
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

/** A notched phone's insets (in CSS px), set on the page as the webview would report them. */
async function insets(page: Page, i: { top: number; right: number; bottom: number; left: number }) {
  await page.evaluate((i) => {
    const s = document.documentElement.style;
    for (const [side, px] of Object.entries(i)) s.setProperty(`--safe-${side}`, `${px}px`);
  }, i);
}

/** Every control in the player's bars lies inside the screen less the insets. */
async function controlsClearOf(page: Page, i: { top: number; right: number; bottom: number; left: number }) {
  const { width, height } = page.viewportSize()!;
  const boxes = await page.locator(".player :is(.player-top, .player-bottom) :is(button, input)").evaluateAll((els) =>
    els.filter((e) => (e as HTMLElement).offsetParent).map((e) => ({ name: e.getAttribute("aria-label") ?? e.textContent, ...e.getBoundingClientRect().toJSON() })),
  );
  expect(boxes.length).toBeGreaterThan(3);
  for (const b of boxes) {
    expect.soft(b.top, `${b.name} below the top inset`).toBeGreaterThanOrEqual(i.top);
    expect.soft(b.bottom, `${b.name} above the bottom inset`).toBeLessThanOrEqual(height - i.bottom);
    expect.soft(b.left, `${b.name} right of the left inset`).toBeGreaterThanOrEqual(i.left);
    expect.soft(b.right, `${b.name} left of the right inset`).toBeLessThanOrEqual(width - i.right);
  }
}

async function openPlayer(page: Page) {
  await page.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Movies", exact: true }).tap();
  await card(page, "The Glass Orchard").tap();
  await page.getByRole("button", { name: "Play", exact: true }).tap();
  const player = page.locator(".player");
  await expect(player).toHaveAttribute("data-started", "true");
  await expect(player).toHaveAttribute("data-chrome", "false");
  await player.tap({ position: { x: 200, y: 300 } });
  await expect(player).toHaveAttribute("data-chrome", "true");
}

test("the player's controls keep clear of the notch and the home indicator, upright and sideways (#172)", async ({ app }) => {
  const upright = { top: 59, right: 0, bottom: 34, left: 0 };
  await insets(app, upright);
  await openPlayer(app);
  await controlsClearOf(app, upright);

  await app.setViewportSize({ width: 915, height: 412 });
  const sideways = { top: 0, right: 59, bottom: 21, left: 59 };
  await insets(app, sideways);
  await controlsClearOf(app, sideways);
});

test.describe("on a tablet", () => {
  test.use({ viewport: { width: 1180, height: 820 } });

  test("the player's controls keep clear of the status bar and the home indicator (#172)", async ({ app }) => {
    await expect(app.locator("html")).toHaveAttribute("data-form", "tablet");
    const tablet = { top: 24, right: 0, bottom: 20, left: 0 };
    await insets(app, tablet);
    await openPlayer(app);
    await controlsClearOf(app, tablet);
  });
});

test("on a phone, a long press on a source opens its info; no i button shows (#229)", async ({ app }) => {
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Movies", exact: true }).tap();
  await card(app, "The Glass Orchard").tap();
  await app.getByRole("button", { name: "Choose source", exact: true }).tap();
  const row = app.locator(".sheet .stream-row").last();
  await expect(row).toBeVisible();
  await expect(app.locator(".sheet .stream-info").first()).toHaveCSS("opacity", "0");
  // What a held finger sends (lib/platform/longPress.ts sends it on iOS; Android's web view itself).
  await row.dispatchEvent("contextmenu");
  const panel = app.getByRole("dialog", { name: "Source Info" });
  await expect(panel).toContainText("https://media.example/token/•••/4.mp4?apikey=•••");
  expect(await panel.textContent()).not.toContain("TOKEN0000");
  expect(await fitsWidth(app)).toBe(true);
  await panel.getByRole("button", { name: "Done" }).tap();
  await expect(panel).toHaveCount(0);
  await expect(app.locator(".sheet")).toBeVisible();
});

test.describe("signed in, on a fresh profile", () => {
  test.use({ account: true });

  test("starting a watch party in the player leaves one party panel up, with the focus in it (#247)", async ({ app }) => {
    await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Movies", exact: true }).tap();
    await card(app, "The Glass Orchard").tap();
    await app.getByRole("button", { name: "Play", exact: true }).tap();
    await expect(app.locator(".player")).toHaveAttribute("data-started", "true");
    await app.getByRole("button", { name: "Watch Party", exact: true }).tap();
    await expect(partySurfaces(app)).toHaveCount(1);
    await app.getByRole("button", { name: "Start a Watch Party" }).tap();
    await expect(app.getByRole("button", { name: "End Party" })).toBeVisible();
    await expect(partySurfaces(app)).toHaveCount(1);
    await expect(app.getByRole("button", { name: "Copy Invite" })).toBeFocused();
  });
});

test.describe("on an iPhone", () => {
  test.use({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148" });

  test("a sheet opens at half the screen, expands and closes like iOS's own (#174)", async ({ app }) => {
    await app.getByRole("button", { name: "Search", exact: true }).tap();
    await app.getByRole("textbox", { name: "Search" }).fill("glass orchard");
    await card(app, "The Glass Orchard").tap();
    await app.getByRole("button", { name: "Choose source", exact: true }).tap();
    const sheet = app.locator(".sheet");
    await expect(sheet).toHaveAttribute("data-detent", "medium");
    const height = app.viewportSize()!.height;
    const top = async () => (await sheet.boundingBox())!.y;
    await expect.poll(top).toBeGreaterThan(height * 0.45);
    await expect.poll(top).toBeLessThan(height * 0.55);

    await sheet.getByRole("button", { name: "Expand" }).tap();
    await expect(sheet).toHaveAttribute("data-detent", "large");
    await expect.poll(top).toBeLessThan(height * 0.05);

    await sheet.getByRole("button", { name: "Collapse" }).tap();
    await expect(sheet).toHaveAttribute("data-detent", "medium");
    // Pushing the list up at half height brings the rest of it up.
    await sheet.locator(".sheet-body").evaluate((b) => {
      const touch = (y: number) => [new Touch({ identifier: 1, target: b, clientX: 100, clientY: y })];
      b.dispatchEvent(new TouchEvent("touchstart", { touches: touch(700), bubbles: true }));
      b.dispatchEvent(new TouchEvent("touchmove", { touches: touch(660), bubbles: true }));
    });
    await expect(sheet).toHaveAttribute("data-detent", "large");

    await expect.poll(top).toBeLessThan(height * 0.05);
    // Pulled down by its header from the top, past half: closed.
    const header = (await sheet.locator(".sheet-header").boundingBox())!;
    const x = header.x + header.width / 2;
    const y = header.y + header.height / 2;
    await app.mouse.move(x, y);
    await app.mouse.down();
    for (let i = 1; i <= 10; i++) await app.mouse.move(x, y + (height * 0.9 * i) / 10);
    await app.mouse.up();
    await expect(sheet).toHaveCount(0);
  });
});
