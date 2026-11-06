import { test as base, expect, type Page } from "@playwright/test";
import { serveMedia } from "./media";

/**
 * Every test starts on fake.html with no network beyond the dev server:
 * media.example answers with a silent WAV (media.ts), every other host is
 * refused, so a test never reaches a real service. Uncaught errors in the
 * page fail the test.
 *
 * Headless WebKit paints backdrop-filter in software: the title page's glass
 * buttons bring it down to about a frame a second, so Playwright's wait for an
 * element to hold still over two frames runs out on clicks and hovers there.
 * In WebKit every page is drawn without it; no test looks at the blur.
 */
export const test = base.extend<{ tv: boolean; app: Page }>({
  /** Start in TV mode (`test.use({ tv: true })`), as the Controls page's switch leaves it. */
  tv: [false, { option: true }],
  app: async ({ page, baseURL, tv, browserName }, use) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    await page.route(
      (url) => url.origin !== new URL(baseURL!).origin && url.protocol.startsWith("http") && url.host !== "media.example",
      (route) => route.abort("blockedbyclient"),
    );
    await serveMedia(page);
    if (browserName === "webkit")
      await page.addInitScript(() =>
        document.addEventListener("DOMContentLoaded", () => {
          const style = document.createElement("style");
          style.textContent = "*, *::before, *::after { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }";
          document.head.append(style);
        }),
      );
    if (tv) await page.addInitScript(() => localStorage.setItem("polar.tvMode", "1"));
    await page.goto("/fake.html");
    await expect(page.locator("#root > *").first()).toBeAttached();
    await use(page);
    expect(errors, "uncaught errors in the page").toEqual([]);
  },
});

export { expect };

/** A poster or row card, by the title's name (its accessible name is "<name> <year>"). */
export const card = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^${name}\\b`) }).first();

/** The player's clock (remaining time by default), as text. */
export const clock = (page: Page) => page.locator(".player-remaining").textContent();
