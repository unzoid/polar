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
