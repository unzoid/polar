import { card, clock, expect, test } from "./fixtures";

// The desktop layout (also run in WebKit on CI). Titles come from src/lib/platform/fake/fixtures.ts.

test("home shows the hero, Continue Watching and rows", async ({ app }) => {
  await expect(app.getByRole("button", { name: "Watch Now" })).toBeVisible();
  await expect(app.getByText("Continue Watching")).toBeVisible();
  await expect(app.getByText("32m left")).toBeVisible();
});

test("each section opens", async ({ app }) => {
  const nav = app.getByRole("navigation", { name: "Primary" });
  for (const section of ["Series", "Movies", "Library"]) {
    await nav.getByRole("button", { name: section, exact: true }).click();
    await expect(app.getByRole("heading", { level: 1, name: section })).toBeVisible();
  }
  // Anime asks AniList from the page; with every outside host refused it says so and offers to try again.
  await nav.getByRole("button", { name: "Anime", exact: true }).click();
  await expect(app.getByText("AniList didn't answer")).toBeVisible();
  await expect(app.getByRole("button", { name: "Try again" })).toBeVisible();
  await nav.getByRole("button", { name: "Movies", exact: true }).click();
  await app.getByRole("radio", { name: "Top Rated" }).click();
  await expect(app.getByRole("radio", { name: "Top Rated" })).toBeChecked();
  await expect(card(app, "Night Ferry")).toBeVisible();
});

test("search finds movies and series", async ({ app }) => {
  await app.getByRole("button", { name: "Search", exact: true }).click();
  await app.keyboard.type("orchard");
  await expect(card(app, "The Glass Orchard")).toBeVisible();
  await expect(card(app, "Orchard House")).toBeVisible();
  await expect(card(app, "Northbound")).toHaveCount(0);
  await app.getByRole("button", { name: "Clear search" }).click();
  await expect(app.getByRole("textbox", { name: "Search" })).toHaveValue("");
});

test("a title page adds to and removes from the Library", async ({ app }) => {
  const nav = app.getByRole("navigation", { name: "Primary" });
  await nav.getByRole("button", { name: "Movies", exact: true }).click();
  await card(app, "Northbound").click();
  await expect(app.getByRole("heading", { level: 1, name: "Northbound" })).toBeVisible();
  await expect(app.getByText("Ines Marchetti").first()).toBeVisible();

  await app.getByRole("button", { name: "Add to Library" }).click();
  await expect(app.getByRole("button", { name: "Remove from Library" })).toHaveAttribute("aria-pressed", "true");
  await nav.getByRole("button", { name: "Library", exact: true }).click();
  await expect(card(app, "Northbound")).toBeVisible();

  await card(app, "Northbound").click();
  await app.getByRole("button", { name: "Remove from Library" }).click();
  await expect(app.getByRole("button", { name: "Add to Library" })).toBeVisible();
  await nav.getByRole("button", { name: "Library", exact: true }).click();
  await expect(app.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
  await expect(card(app, "Northbound")).toHaveCount(0);
});

test("a movie plays in the built-in player, pauses and closes", async ({ app }) => {
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Movies", exact: true }).click();
  await card(app, "The Glass Orchard").click();
  await app.getByRole("button", { name: "Play", exact: true }).click();

  const player = app.locator(".player");
  await expect(player).toHaveAttribute("data-started", "true");
  await expect(app.getByRole("button", { name: "Pause" })).toBeVisible();
  // The clock counts down while it plays...
  const first = await clock(app);
  await expect.poll(() => clock(app), { timeout: 8000 }).not.toBe(first);
  // ...and stops when paused.
  await app.keyboard.press(" ");
  await expect(app.getByRole("button", { name: "Play", exact: true })).toBeVisible();
  const paused = await clock(app);
  await app.waitForTimeout(1500);
  expect(await clock(app)).toBe(paused);

  await app.getByRole("button", { name: "Sources", exact: true }).click();
  // The source bar's controls never stick out past the list (re-test N9), at any width.
  for (const width of [1440, 1100]) {
    await app.setViewportSize({ width, height: 900 });
    const filters = await app.locator(".srcf-filters").boundingBox();
    const list = await app.locator(".options-column[data-size=wide] .options-list").boundingBox();
    expect(filters!.x + filters!.width).toBeLessThanOrEqual(list!.x + list!.width);
  }
  await app.keyboard.press("Escape");
  await app.keyboard.press("Escape");
  await expect(player).toHaveCount(0);
});

test("settings change and stay changed", async ({ app }) => {
  const open = async () => {
    await app.getByRole("button", { name: /^Profile/ }).click();
    await app.getByRole("menuitem", { name: "Settings" }).click();
    return app.getByRole("dialog", { name: /^Settings/ });
  };
  let settings = await open();
  const skip = settings.getByRole("switch", { name: /^Skip intros/ });
  await expect(skip).not.toBeChecked();
  await skip.click();
  await expect(skip).toBeChecked();
  await settings.getByRole("button", { name: "Close settings" }).click();
  await expect(settings).toHaveCount(0);

  settings = await open();
  await expect(settings.getByRole("switch", { name: /^Skip intros/ })).toBeChecked();
  await settings.getByRole("button", { name: "Appearance", exact: true }).click();
  await expect(settings.getByRole("heading", { level: 2, name: /Appearance/ }).first()).toBeVisible();
  await app.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);
});
