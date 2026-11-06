import { card, clock, expect, test } from "./fixtures";

// The desktop layout (also run in WebKit on CI). Titles come from src/lib/platform/fake/fixtures.ts.

test("home shows the hero, Continue Watching and rows", async ({ app }) => {
  await expect(app.getByRole("button", { name: "Watch Now" })).toBeVisible();
  await expect(app.getByText("Continue Watching")).toBeVisible();
  await expect(app.getByText("32m left")).toBeVisible();
});

test("the featured carousel's active dot fills with a round end (#33)", async ({ app }) => {
  const fill = app.locator(".hero-dot-fill");
  await expect(fill).toHaveCount(1);
  // Halfway through: a scaled fill would squash its rounded end flat, a rounded clip keeps it.
  const style = await fill.evaluate((el) => {
    const [a] = el.getAnimations();
    a.pause();
    a.currentTime = Number(a.effect!.getComputedTiming().duration) / 2;
    const s = getComputedStyle(el);
    return { transform: s.transform, clipPath: s.clipPath };
  });
  expect(style.transform).toBe("none");
  expect(style.clipPath).toMatch(/^inset\(0px 50% 0px 0px round/);
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

test("the Calendar is in the profile menu only while it isn't a navbar tab (#92)", async ({ app }) => {
  const nav = app.getByRole("navigation", { name: "Primary" });
  const profile = app.getByRole("button", { name: /^Profile/ });
  await expect(nav.getByRole("button", { name: "Calendar", exact: true })).toHaveCount(0);
  await profile.click();
  await expect(app.getByRole("menuitem", { name: "Calendar" })).toBeVisible();
  await app.getByRole("menuitem", { name: "Settings" }).click();
  const settings = app.getByRole("dialog", { name: /^Settings/ });
  await settings.getByRole("button", { name: "Browsing", exact: true }).click();
  await settings.getByRole("switch", { name: /^Show the Calendar/ }).click();
  await settings.getByRole("button", { name: "Close settings" }).click();
  await expect(settings).toHaveCount(0);
  await expect(nav.getByRole("button", { name: "Calendar", exact: true })).toBeVisible();
  await profile.click();
  await expect(app.getByRole("menuitem", { name: "Settings" })).toBeVisible();
  await expect(app.getByRole("menuitem", { name: "Calendar" })).toHaveCount(0);
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

test("a wheel turn down a show's page lands its season tabs below the navbar's blur (#20)", async ({ app }) => {
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Series", exact: true }).click();
  await card(app, "Fieldwork").click();
  await expect(app.getByRole("heading", { level: 1, name: "Fieldwork" })).toBeVisible();
  const tabs = app.locator(".seasons-bar");
  await expect(tabs).toBeVisible();
  await app.locator(".detail-hero").hover();
  await app.mouse.wheel(0, 120);
  // The glide has landed when the tabs stop moving.
  let last = NaN;
  await expect.poll(async () => {
    const y = (await tabs.boundingBox())!.y;
    const still = y === last;
    last = y;
    return still;
  }, { intervals: [300] }).toBe(true);
  const band = await app.locator(".navbar-fade").boundingBox();
  expect(last).toBeLessThan(400);
  expect(last).toBeGreaterThanOrEqual(band!.y + band!.height);

  // Back from the player, the page is where it was when the episode started.
  await app.locator(".episode-card-main:not([disabled])").first().click();
  const player = app.locator(".player");
  await expect(player).toHaveAttribute("data-started", "true");
  await app.keyboard.press("Escape");
  await expect(player).toHaveCount(0);
  expect((await tabs.boundingBox())!.y).toBe(last);
});

test("an episode's Sources and Download buttons show alike, on a dark fill, without hovering (#18)", async ({ app }) => {
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Series", exact: true }).click();
  await card(app, "Fieldwork").click();
  const ep = app.locator(".episode-card:has(.episode-card-main:not([disabled]))").first();
  await expect(ep).toBeVisible();
  await app.mouse.move(0, 0);
  const look = (sel: string) =>
    ep.locator(sel).evaluate((b) => {
      const s = getComputedStyle(b);
      const alpha = Number(/rgba?\(([^)]+)\)/.exec(s.backgroundColor)?.[1].split(",")[3] ?? 1);
      return { opacity: s.opacity, alpha, color: s.color, size: b.getBoundingClientRect().width };
    });
  const sources = await look(".episode-sources");
  const download = await look(".episode-download");
  expect(sources).toEqual(download);
  expect(sources.opacity).toBe("1");
  expect(sources.color).toBe("rgb(255, 255, 255)");
  expect(sources.alpha).toBeGreaterThanOrEqual(0.5);
});

test("a downloaded episode offers Show in Folder and Delete as buttons, and Play takes the download (#25)", async ({ app }) => {
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Series", exact: true }).click();
  await card(app, "Fieldwork").click();
  const ep = app.locator(".episode-card:has(.episode-card-main:not([disabled]))").first();
  await ep.getByRole("button", { name: "Download Episode" }).click();
  await app.locator(".sheet .stream-row").first().click();
  await expect(app.locator(".sheet")).toHaveCount(0);

  const reveal = ep.getByRole("button", { name: "Show Downloaded Episode in Folder" });
  const del = ep.getByRole("button", { name: "Delete Downloaded Episode" });
  await expect(reveal).toBeVisible();
  await expect(del).toBeVisible();
  await expect(ep.locator("[aria-haspopup]")).toHaveCount(0);
  // Side by side on the still, left of Sources, not on top of each other.
  const [r, d, s] = await Promise.all([reveal, del, ep.locator(".episode-sources")].map((b) => b.boundingBox()));
  expect(r!.x + r!.width).toBeLessThanOrEqual(d!.x);
  expect(d!.x + d!.width).toBeLessThanOrEqual(s!.x);

  await ep.locator(".episode-card-main").click();
  await expect(app.locator(".player video")).toHaveAttribute("src", /\/downloads\/.+\.mkv$/);
  await app.keyboard.press("Escape");
  await expect(app.locator(".player")).toHaveCount(0);

  // Delete asks for a second click.
  await del.click();
  const armed = ep.getByRole("button", { name: "Click again to delete the downloaded episode" });
  await armed.click();
  await expect(ep.getByRole("button", { name: "Download Episode" })).toBeVisible();
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

test("a source list marks its first links ready or not ready, checked ahead of time (#21)", async ({ app }) => {
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Movies", exact: true }).click();
  await card(app, "The Glass Orchard").click();
  await app.getByRole("button", { name: "Choose source", exact: true }).click();
  // The fake shell answers every link as ready in 0.4 s except one placeholder.
  const ready = app.locator('.stream-row[data-ready="yes"]');
  const notReady = app.locator('.stream-row[data-ready="no"]');
  await expect(ready.first()).toContainText("Ready · starts in 0.4 s");
  await expect(ready.first().locator(".stream-lead svg")).toBeVisible();
  await expect(ready.first()).toHaveAttribute("title", /^Ready to play: this link answered with the video in 0\.4 s/);
  await expect(ready).toHaveCount(3);
  await expect(notReady).toHaveCount(1);
  await expect(notReady).toContainText("Not ready at the source");
  expect(await notReady.locator(".stream-text").evaluate((e) => getComputedStyle(e).opacity)).toBe("0.5");
  // Only the first few are checked: the last source stays as it was.
  await expect(app.locator(".stream-row").last()).not.toHaveAttribute("data-ready");
});

test("the player's Sources panel marks the same links (#21)", async ({ app }) => {
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Movies", exact: true }).click();
  await card(app, "The Glass Orchard").click();
  await app.getByRole("button", { name: "Play", exact: true }).click();
  await expect(app.locator(".player")).toHaveAttribute("data-started", "true");
  await app.getByRole("button", { name: "Sources", exact: true }).click();
  const sources = app.getByRole("radiogroup", { name: "Sources" });
  // The source playing keeps its check; the next ones are marked.
  await expect(sources.locator('[data-ready="yes"]')).toHaveCount(3);
  await expect(sources.locator('[data-ready="no"]')).toContainText("Not ready at the source");
  await expect(sources.locator('[data-ready="yes"]').nth(1).locator(".options-check svg")).toBeVisible();
  await expect(sources.locator('[data-ready="yes"]').nth(1)).toContainText("Ready · starts in 0.4 s");
});

test("while a downloaded episode plays, its copy is the first source and picking it goes back to the file (#23)", async ({ app }) => {
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Series", exact: true }).click();
  await card(app, "Fieldwork").click();
  const ep = app.locator(".episode-card:has(.episode-card-main:not([disabled]))").first();
  await ep.getByRole("button", { name: "Download Episode" }).click();
  await app.locator(".sheet .stream-row").first().click();
  await expect(ep.getByRole("button", { name: "Delete Downloaded Episode" })).toBeVisible();

  await ep.locator(".episode-card-main").click();
  const video = app.locator(".player video");
  await expect(video).toHaveAttribute("src", /\/downloads\/.+\.mkv$/);
  const sources = app.getByRole("radiogroup", { name: "Sources" });
  const open = async () => {
    await app.getByRole("button", { name: "Sources", exact: true }).click();
    await expect(sources).toBeVisible();
  };
  await open();
  const copy = sources.getByRole("radio").first();
  await expect(copy).toContainText("Downloaded copy");
  await expect(copy).toContainText("On this device");
  await expect(copy).toHaveAttribute("aria-checked", "true");

  // Another source, then back to the copy.
  await sources.getByRole("radio").nth(2).click();
  await expect(video).toHaveAttribute("src", /^https:\/\/media\.example\//);
  await open();
  await expect(sources.getByRole("radio").first()).toHaveAttribute("aria-checked", "false");
  await sources.getByRole("radio").first().click();
  await expect(video).toHaveAttribute("src", /\/downloads\/.+\.mkv$/);
});

test("a Stremio export is read, previewed and imported; its add-ons are only listed (#12)", async ({ app }) => {
  const file = {
    addons: {
      addons: [{ transportUrl: "https://addon.example.org/TOKEN/manifest.json", flags: {}, manifest: { id: "org.example.one", name: "Example One" } }],
    },
    library: [
      {
        _id: "0001",
        d: {
          _id: "tt0000999",
          _ctime: "2026-01-01T10:00:00.000Z",
          _mtime: "2026-01-02T10:00:00.000Z",
          type: "movie",
          name: "Harbour Lights",
          removed: false,
          temp: false,
          state: { video_id: "tt0000999", timeOffset: 1_200_000, duration: 5_400_000, lastWatched: "2026-01-02T10:00:00.000Z" },
        },
      },
    ],
  };
  await app.getByRole("button", { name: /^Profile/ }).click();
  await app.getByRole("menuitem", { name: "Settings" }).click();
  const settings = app.getByRole("dialog", { name: /^Settings/ });
  // Signed out (as here), it's under Advanced; signed in, under Account.
  await settings.getByRole("button", { name: "Advanced", exact: true }).click();
  await settings.locator('input[type="file"]').setInputFiles({ name: "export.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
  await expect(settings.getByText("1 title Polarity can show")).toBeVisible();
  await expect(settings.getByRole("switch", { name: /^Where you left off/ })).toBeChecked();
  const addon = settings.getByRole("switch", { name: /^Example One/ });
  await expect(addon).not.toBeChecked();
  await settings.getByRole("button", { name: "Import", exact: true }).click();
  await expect(settings.getByText("Added 1 title to your library and 1 progress entry.")).toBeVisible();
  await expect(addon).toHaveCount(0);
});

test("the title page's Download button names what it downloads (#26)", async ({ app }) => {
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Series", exact: true }).click();
  await card(app, "Fieldwork").click();
  const actions = app.locator(".detail-actions");
  await expect(actions.getByRole("button", { name: "Download S1 E1", exact: true })).toHaveText("Download S1 E1");
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Movies", exact: true }).click();
  await card(app, "The Glass Orchard").click();
  await expect(actions.getByRole("button", { name: "Download Movie", exact: true })).toHaveText("Download Movie");
});
