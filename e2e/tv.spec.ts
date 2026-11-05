import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// TV mode at 1920×1080, driven only by the arrow keys, Enter and Backspace (a remote's Back).
test.use({ tv: true });

const focused = (page: Page) => page.locator(":focus");

async function press(page: Page, ...keys: string[]) {
  for (const key of keys) await page.keyboard.press(key);
}

test("arrows move between cards and Back returns to the same card", async ({ app }) => {
  await expect(focused(app)).toHaveAccessibleName("The Understudies");
  await press(app, "ArrowDown");
  await expect(focused(app)).toHaveAccessibleName("Tidewater");
  await press(app, "ArrowRight", "ArrowRight");
  await expect(focused(app)).toHaveAccessibleName("Quiet Machines");

  await press(app, "Enter");
  await expect(app.getByRole("heading", { level: 1, name: "Quiet Machines" })).toBeVisible();
  await expect(focused(app)).toHaveAccessibleName("Play First Episode");

  await press(app, "Backspace");
  await expect(focused(app)).toHaveAccessibleName("Quiet Machines");
  await expect(app.getByRole("heading", { level: 2, name: "Trending Now" })).toBeVisible();
});

test("the section tabs are reached from the top row", async ({ app }) => {
  await expect(focused(app)).toHaveAccessibleName("The Understudies");
  await press(app, "ArrowUp");
  await expect(focused(app)).toHaveAccessibleName("Home");
  await press(app, "ArrowRight", "ArrowRight", "Enter");
  await expect(focused(app)).toHaveAccessibleName("Movies");
  await press(app, "ArrowDown");
  await expect(focused(app)).toHaveClass(/tv-card/);
});

test("a title plays from the remote and Back leaves the player", async ({ app }) => {
  await press(app, "ArrowDown", "ArrowRight", "ArrowRight", "Enter");
  await expect(focused(app)).toHaveAccessibleName("Play First Episode");
  await press(app, "Enter");
  await expect(app.locator(".player")).toHaveAttribute("data-started", "true");
  await press(app, "Backspace");
  await expect(app.locator(".player")).toHaveCount(0);
  await expect(app.getByRole("heading", { level: 1, name: "Quiet Machines" })).toBeVisible();
});

test("in a title's Sources, up and down move between the rows of filter chips (re-test 7)", async ({ app }) => {
  await press(app, "ArrowDown", "ArrowRight", "ArrowRight", "Enter");
  await expect(focused(app)).toHaveAccessibleName("Play First Episode");
  await app.getByRole("button", { name: "Choose Source" }).focus();
  await press(app, "Enter");
  const panel = app.getByRole("dialog", { name: "Sources" });
  await expect(panel).toBeVisible();
  const row = () => focused(app).evaluate((el) => el.closest(".srcf-chiprow")?.getAttribute("aria-label") ?? "list");
  await panel.getByRole("group", { name: "Quality" }).getByRole("button").first().focus();
  await press(app, "ArrowDown");
  expect(await row()).toBe("Add-on");
  await press(app, "ArrowUp");
  expect(await row()).toBe("Quality");
});

test("in the player's Sources, up and down move between the rows of filter chips (re-test 7)", async ({ app }) => {
  await press(app, "ArrowDown", "ArrowRight", "ArrowRight", "Enter");
  await expect(focused(app)).toHaveAccessibleName("Play First Episode");
  await press(app, "Enter");
  await expect(app.locator(".player")).toHaveAttribute("data-started", "true");
  await app.getByRole("button", { name: "Sources", exact: true }).click();
  const head = app.locator(".options-column").filter({ has: app.locator(".srcf") });
  await head.getByRole("group", { name: "Quality" }).getByRole("button").first().focus();
  const row = () => focused(app).evaluate((el) => el.closest(".srcf-chiprow")?.getAttribute("aria-label") ?? "list");
  await press(app, "ArrowDown");
  expect(await row()).toBe("Add-on");
  await press(app, "ArrowUp");
  expect(await row()).toBe("Quality");
});
