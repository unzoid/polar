import { test as base, expect, type Page } from "@playwright/test";
import { serveMedia } from "./media";

/**
 * Every test starts on fake.html with no network beyond the dev server:
 * media.example answers with a silent WAV (media.ts), every other host is
 * refused, so a test never reaches a real service. Uncaught errors in the
 * page fail the test, except WebKit's own note on a load refused here (see
 * refusedLoad).
 *
 * Headless WebKit paints backdrop-filter in software: the title page's glass
 * buttons bring it down to about a frame a second, so Playwright's wait for an
 * element to hold still over two frames runs out on clicks and hovers there.
 * In WebKit every page is drawn without it; no test looks at the blur.
 */
export const test = base.extend<{ tv: boolean; account: boolean; app: Page }>({
  /** Start in TV mode (`test.use({ tv: true })`), as the Controls page's switch leaves it. */
  tv: [false, { option: true }],
  /** Start signed in to the fake shell's account, with watch parties in the page (`test.use({ account: true })`). */
  account: [false, { option: true }],
  app: async ({ page, baseURL, tv, account, browserName }, use) => {
    const errors: string[] = [];
    const refused = new Set<string>();
    page.on("pageerror", (e) => {
      if (browserName === "webkit" && refusedLoad(e, refused)) return;
      errors.push(String(e));
    });
    await page.route(
      (url) => url.origin !== new URL(baseURL!).origin && url.protocol.startsWith("http") && url.host !== "media.example",
      (route) => {
        refused.add(route.request().url());
        return route.abort("blockedbyclient");
      },
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
    await page.goto(account ? "/fake.html?account=1" : "/fake.html");
    await expect(page.locator("#root > *").first()).toBeAttached();
    await use(page);
    expect(errors, "uncaught errors in the page").toEqual([]);
  },
});

export { expect };

/**
 * WebKit's console note on a failed load of another origin, "Fetch API cannot load <url> due to access control
 * checks.", which Playwright passes on as an error in the page now and then (with the fetch's call stack, but no
 * TypeError and no "Unhandled Promise Rejection"), even when the app catches the failed fetch. Only the note for a
 * URL this fixture refused is let through.
 */
function refusedLoad(e: Error, refused: Set<string>): boolean {
  const m = /^Fetch API cannot load (\S+) due to access control checks\.$/.exec((e.stack ?? "").split("\n")[0]);
  return !!m && refused.has(m[1]);
}

/** A poster or row card, by the title's name (its accessible name is "<name> <year>"). */
export const card = (page: Page, name: string) => page.getByRole("button", { name: new RegExp(`^${name}\\b`) }).first();

/** The player's clock (remaining time by default), as text. */
export const clock = (page: Page) => page.locator(".player-remaining").textContent();

/**
 * The watch party's dialogs and panels on screen (#247): the join dialog, a link to confirm, "Watch party over",
 * the party menu (top bar popover, TV panel) and the player's Watch Party panel. Never more than one.
 */
export const partySurfaces = (page: Page) =>
  page
    .locator(".party-dialog, .party-link-confirm, .party-popover, .tv-party, .tv-join, .options-overlay[data-open=true]:has(.party-pane, .party-column)")
    .filter({ visible: true });
