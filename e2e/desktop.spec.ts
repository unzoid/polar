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
  // Halfway through: a scaled fill would squash its rounded end flat; a whole pill slid halfway in under a
  // rounded clip keeps it. Sliding is a transform, which the compositor runs (no repaint per frame, #134).
  const style = await fill.evaluate((el) => {
    const [a] = el.getAnimations();
    a.pause();
    a.currentTime = Number(a.effect!.getComputedTiming().duration) / 2;
    const s = getComputedStyle(el);
    const clip = getComputedStyle(el.parentElement!);
    return { transform: s.transform, width: el.getBoundingClientRect().width, clipPath: s.clipPath, overflow: clip.overflow, radius: clip.borderRadius };
  });
  const m = style.transform.match(/^matrix\(1, 0, 0, 1, (-?[\d.]+), 0\)$/);
  expect(m, style.transform).not.toBeNull();
  expect(Number(m![1])).toBeCloseTo(-style.width / 2, 0);
  expect(style.clipPath).toBe("none");
  expect(style.overflow).toBe("hidden");
  expect(style.radius).not.toBe("0px");
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

test("an episode's Sources and Download buttons show alike, quietly, only while the card is pointed at or focused (#18, #79)", async ({ app }) => {
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
  // Out of the way while nothing points at the card.
  await expect.poll(() => look(".episode-sources").then((l) => l.opacity)).toBe("0");
  expect((await look(".episode-download")).opacity).toBe("0");

  // Pointing at the card shows both, alike: a white glyph on a lighter fill than before, the same size.
  await ep.hover();
  await expect.poll(() => look(".episode-sources").then((l) => l.opacity)).toBe("1");
  const sources = await look(".episode-sources");
  const download = await look(".episode-download");
  expect(sources).toEqual(download);
  expect(sources.color).toBe("rgb(255, 255, 255)");
  expect(sources.alpha).toBeGreaterThanOrEqual(0.4);
  expect(sources.alpha).toBeLessThan(0.55);
  expect(sources.size).toBe(32);

  // Keyboard focus on the card shows them too; the tap area stays 44 px.
  await app.mouse.move(0, 0);
  await expect.poll(() => look(".episode-sources").then((l) => l.opacity)).toBe("0");
  await ep.locator(".episode-card-main").focus();
  await app.keyboard.press("Shift+Tab");
  await app.keyboard.press("Tab");
  await expect.poll(() => look(".episode-sources").then((l) => l.opacity)).toBe("1");
  const tap = await ep.locator(".episode-sources").evaluate((b) => {
    const a = getComputedStyle(b, "::after");
    return b.getBoundingClientRect().width - 2 * parseFloat(a.top);
  });
  expect(tap).toBe(44);
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

  // A click that misses a control inside the panel, or lands just past it, leaves it open; clearly outside closes it (#202).
  await app.getByRole("button", { name: "Subtitles & Audio", exact: true }).click();
  const overlay = app.locator(".options-overlay[data-open=true]");
  await expect(overlay).toBeVisible();
  const [audio, subs] = await Promise.all([0, 1].map((i) => app.locator(".options-column").nth(i).boundingBox()));
  await app.mouse.click((audio!.x + audio!.width + subs!.x) / 2, audio!.y + 40);
  await app.mouse.click(audio!.x - 12, audio!.y + 40);
  await expect(overlay).toBeVisible();
  await app.mouse.click(8, 8 + 450);
  await expect(app.locator(".options-overlay")).toHaveCount(0);

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

test("with an AirPlay receiver around, the player sends the video to it and back (#19)", async ({ app }) => {
  // WebKit's AirPlay surface, as WKWebView on macOS has it: a receiver is there, and the picker toggles to it and back.
  await app.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.WebKitPlaybackTargetAvailabilityEvent = class extends Event {};
    const wireless = new WeakSet<HTMLMediaElement>();
    const add = HTMLMediaElement.prototype.addEventListener;
    HTMLMediaElement.prototype.addEventListener = function (this: HTMLMediaElement, type: string, ...rest: unknown[]) {
      (add as (...a: unknown[]) => void).call(this, type, ...rest);
      if (type === "webkitplaybacktargetavailabilitychanged")
        setTimeout(() => this.dispatchEvent(Object.assign(new Event(type), { availability: "available" })), 50);
    } as typeof add;
    Object.defineProperty(HTMLMediaElement.prototype, "webkitCurrentPlaybackTargetIsWireless", {
      get(this: HTMLMediaElement) {
        return wireless.has(this);
      },
    });
    Object.defineProperty(HTMLMediaElement.prototype, "webkitShowPlaybackTargetPicker", {
      value(this: HTMLMediaElement) {
        if (wireless.has(this)) wireless.delete(this);
        else wireless.add(this);
        this.dispatchEvent(new Event("webkitcurrentplaybacktargetiswirelesschanged"));
      },
    });
  });
  await app.reload();
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Movies", exact: true }).click();
  await card(app, "The Glass Orchard").click();
  await app.getByRole("button", { name: "Play", exact: true }).click();
  await expect(app.locator(".player")).toHaveAttribute("data-started", "true");

  const airplay = app.locator(".player-top").getByRole("button", { name: "AirPlay" });
  await expect(airplay).toBeVisible();
  await airplay.click();
  await expect(app.getByText("Playing on AirPlay")).toBeVisible();
  await expect(airplay).toHaveAttribute("aria-pressed", "true");
  // The controls still drive it.
  await app.keyboard.press(" ");
  await expect(app.getByRole("button", { name: "Play", exact: true })).toBeVisible();

  // Picking this computer again plays here.
  await app.locator(".player-casting").getByRole("button", { name: "AirPlay" }).click();
  await expect(app.getByText("Playing on AirPlay")).toHaveCount(0);
  await expect(airplay).toHaveAttribute("aria-pressed", "false");
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

test("Settings → Sources has the torrent limits, kept on this device (#47)", async ({ app }) => {
  const open = async () => {
    await app.getByRole("button", { name: /^Profile/ }).click();
    await app.getByRole("menuitem", { name: "Settings" }).click();
    const settings = app.getByRole("dialog", { name: /^Settings/ });
    await settings.getByRole("button", { name: "Sources", exact: true }).click();
    return settings;
  };
  let settings = await open();
  await expect(settings.getByRole("heading", { name: "Torrent Sources" })).toBeVisible();
  await expect(settings.getByText("Torrent cache limit")).toBeVisible();
  await expect(settings.getByText("Torrent download limit")).toBeVisible();
  // Upload has a limit of its own, on by default; download has none (#137).
  await expect(settings.getByRole("textbox", { name: "Torrent upload limit" })).toHaveValue("4");
  await expect(settings.getByRole("textbox", { name: "Torrent download limit" })).toHaveValue("");
  await expect(settings.getByRole("switch", { name: /^Explain torrent playback first/ })).toBeChecked();
  const sharing = settings.getByRole("switch", { name: /^Keep sharing after playback/ });
  // Nothing is shared after playback until the user turns it on.
  await expect(sharing).not.toBeChecked();
  await sharing.click();
  await expect(sharing).toBeChecked();
  await app.keyboard.press("Escape");
  await expect(settings).toHaveCount(0);

  settings = await open();
  await expect(settings.getByRole("switch", { name: /^Keep sharing after playback/ })).toBeChecked();
  expect(await app.evaluate(() => JSON.parse(localStorage.getItem("polar.prefs") ?? "{}").torrentKeepSharing)).toBe(true);
});

test("the first torrent source shows a notice once: Cancel plays nothing, Play goes on and it doesn't come back (#137)", async ({ app }) => {
  await app.addInitScript(() => localStorage.setItem("polar.fakeTorrents", "1"));
  await app.reload();
  const opens = () => app.evaluate(() => (window as { __torrentOpens?: number }).__torrentOpens ?? 0);
  const play = async () => {
    await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Movies", exact: true }).click();
    await card(app, "The Glass Orchard").click();
    await app.getByRole("button", { name: "Play", exact: true }).click();
  };
  const notice = app.getByRole("dialog", { name: "Torrent playback" });
  const player = app.locator(".player");

  await play();
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("from your add-on");
  await expect(notice.getByRole("textbox", { name: "Upload limit" })).toHaveValue("4");
  await notice.getByRole("button", { name: "Cancel" }).click();
  await expect(player).toHaveCount(0);
  expect(await opens()).toBe(0);

  await play();
  await notice.getByRole("button", { name: "Play", exact: true }).click();
  await expect(notice).toHaveCount(0);
  await expect.poll(opens).toBe(1);
  expect(await app.evaluate(() => JSON.parse(localStorage.getItem("polar.prefs") ?? "{}").torrentNotice)).toBe(false);
  await app.keyboard.press("Escape");
  await expect(player).toHaveCount(0);

  // Once Play was chosen, the next torrent opens straight away.
  await play();
  await expect.poll(opens).toBe(2);
  await expect(notice).toHaveCount(0);
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

test("Download Season downloads every released episode of the season, then says so (#24)", async ({ app }) => {
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Series", exact: true }).click();
  await card(app, "Fieldwork").click();
  const season = app.locator(".seasons-bar").getByRole("button", { name: /^Download Season/ });
  await expect(season).toBeEnabled();
  // A show's downloads live with its episodes: the season bar, and each episode.
  await expect(app.locator(".detail-actions").getByRole("button", { name: /^Download/ })).toHaveCount(0);
  await season.click();
  // The fake shell finishes each download at once.
  await expect(app.locator(".seasons-bar").getByRole("button", { name: "Season Downloaded" })).toBeDisabled({ timeout: 15_000 });
  const released = app.locator(".episode-card:has(.episode-card-main:not([disabled]))");
  const count = await released.count();
  expect(count).toBeGreaterThan(1);
  await expect(released.getByRole("button", { name: "Delete Downloaded Episode" })).toHaveCount(count);
});

test("a movie's page has a Download button that names what it downloads; a show's action row has none (#26)", async ({ app }) => {
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Series", exact: true }).click();
  await card(app, "Fieldwork").click();
  const actions = app.locator(".detail-actions");
  await expect(actions.locator(".detail-play")).toBeVisible();
  await expect(actions.getByRole("button", { name: /^Download/ })).toHaveCount(0);
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Movies", exact: true }).click();
  await card(app, "The Glass Orchard").click();
  await expect(actions.getByRole("button", { name: "Download Movie", exact: true })).toHaveText("Download Movie");
});

test("with Show on Discord set to the title, the player sends what plays, its pause, and clears it on close (#31)", async ({ app }) => {
  const sent = () => app.evaluate(() => ((window as { __discord?: unknown[] }).__discord ?? []) as ({ details: string; state?: string; end?: number } | null)[]);
  await app.getByRole("button", { name: /^Profile/ }).click();
  await app.getByRole("menuitem", { name: "Settings" }).click();
  const settings = app.getByRole("dialog", { name: /^Settings/ });
  await settings.getByRole("combobox", { name: "Show on Discord" }).click();
  await app.getByRole("option", { name: "What you're watching" }).click();
  await settings.getByRole("button", { name: "Close settings" }).click();

  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Movies", exact: true }).click();
  await card(app, "The Glass Orchard").click();
  await app.getByRole("button", { name: "Play", exact: true }).click();
  await expect(app.locator(".player")).toHaveAttribute("data-started", "true");
  await expect.poll(async () => (await sent()).at(-1)).toMatchObject({ details: "The Glass Orchard" });
  expect((await sent()).at(-1)?.end).toBeGreaterThan(Date.now());

  await app.keyboard.press(" ");
  await expect.poll(async () => (await sent()).at(-1)?.state).toBe("Paused");
  await app.keyboard.press("Escape");
  await expect(app.locator(".player")).toHaveCount(0);
  await expect.poll(async () => (await sent()).at(-1)).toBeNull();
  // Nothing was sent before it played.
  expect((await sent())[0]).not.toBeNull();
});

test("a Home shelf's heading opens its browse page with the filter on, and Back returns to the same place (#48)", async ({ app }) => {
  const home = app.locator('.page[data-active="true"] .scroll');
  const heading = app.getByRole("button", { name: "New Movies", exact: true });
  await heading.scrollIntoViewIfNeeded();
  const before = await home.evaluate((el) => el.scrollTop);
  expect(before).toBeGreaterThan(0);
  // Reachable with the keyboard, like any button.
  await heading.focus();
  await app.keyboard.press("Enter");

  await expect(app.getByRole("heading", { level: 1, name: "Movies" })).toBeVisible();
  await expect(app.getByRole("radiogroup", { name: "Catalog" }).getByRole("radio", { name: "New" })).toBeChecked();
  await expect(app.getByRole("combobox", { name: "Genre" })).toHaveText(/All Genres/);

  await app.keyboard.press("Escape");
  await expect(heading).toBeVisible();
  expect(await home.evaluate((el) => el.scrollTop)).toBe(before);

  // A genre shelf (today's pick) opens its type at Popular with that genre picked.
  const genreTitles = await app.locator(".row-title-link").allTextContents();
  // lib/catalog/shelves.ts's GENRES.
  const known = ["Action & Adventure", "Sci-Fi Movies", "Animated Movies", "Comedy Movies", "Horror Movies", "Thrillers", "Romance Movies", "Crime Movies"]
    .concat(["Fantasy Movies", "Documentaries", "Comedy Series", "Crime Series", "Drama Series", "Sci-Fi & Fantasy Series", "Animated Series", "Mystery Series", "Docuseries"]);
  const pick = genreTitles.map((t) => t.trim()).find((t) => known.includes(t));
  expect(pick).toBeDefined();
  await app.getByRole("button", { name: pick, exact: true }).click();
  await expect(app.getByRole("radiogroup", { name: "Catalog" }).getByRole("radio", { name: "Popular" })).toBeChecked();
  await expect(app.getByRole("combobox", { name: "Genre" })).not.toHaveText(/All Genres/);
});

test("with seasons as separate shows, Continue Watching names the anime entry the episode is part of, and only then (#22)", async ({ app }) => {
  const row = app.locator(".row").filter({ has: app.getByRole("heading", { name: "Continue Watching" }) });
  // The first title on the fake backend is at season 2, episode 3; its stored card names the show.
  const stored = (await row.locator(".card").first().textContent()) ?? "";
  expect(stored).toContain("S2");
  await app.addInitScript(() => {
    localStorage.setItem("polar.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("polar.prefs") ?? "{}"), animeSeparateEntries: true }));
    // What an anime page leaves: season 2's episodes 1–12 are this entry's 1–12.
    localStorage.setItem("polar.animeEntries.v1", JSON.stringify({ tt9200001: { "21": { title: { english: "Paper Moon Part 2" }, runs: [[2, 1, 12, 1]], at: 1 } } }));
  });
  await app.reload();
  const first = row.locator(".card").first();
  await expect(first).toContainText("Paper Moon Part 2");
  await expect(first).toContainText("Episode 3 · Chapter 3: Crossings");

  // Off again: the card is the stored title's, as before.
  await app.addInitScript(() =>
    localStorage.setItem("polar.prefs", JSON.stringify({ ...JSON.parse(localStorage.getItem("polar.prefs") ?? "{}"), animeSeparateEntries: false })),
  );
  await app.reload();
  await expect(row.locator(".card").first()).not.toContainText("Paper Moon Part 2");
  await expect(row.locator(".card").first()).toContainText("S2");
});

test("the player's episode rail reaches every episode by wheel and paddles, and its row/list switch is the title page's (#226)", async ({ app }) => {
  await app.getByRole("navigation", { name: "Primary" }).getByRole("button", { name: "Series", exact: true }).click();
  await card(app, "Fieldwork").click();
  await expect(app.locator(".episode-card")).toHaveCount(10);
  await app.locator(".episode-card-main:not([disabled])").first().click();
  await expect(app.locator(".player")).toHaveAttribute("data-started", "true");
  await app.getByRole("button", { name: "Episodes", exact: true }).click();
  const rail = app.locator(".episode-rail");
  const last = rail.locator(".episode-rail-card").last();
  // Whether the season's last episode is wholly in the rail's view.
  const lastShown = () =>
    rail.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const c = el.lastElementChild!.getBoundingClientRect();
      return c.left >= r.left - 1 && c.right <= r.right + 1;
    });
  await expect(last).toBeAttached();
  expect(await lastShown()).toBe(false);

  // A mouse wheel turns up/down only: it moves the rail along, and the player's re-renders don't put it back.
  const box = (await rail.boundingBox())!;
  await app.mouse.move(box.x + box.width / 2, box.y + 60);
  for (let i = 0; i < 40 && !(await lastShown()); i++) await app.mouse.wheel(0, 120);
  expect(await lastShown()).toBe(true);
  await app.waitForTimeout(1500);
  expect(await lastShown()).toBe(true);
  await expect(app.locator(".episode-rail-paddle[data-dir=next]")).toHaveCSS("opacity", "0");

  // The paddle at the start pages back to the first episode.
  const prev = app.locator(".episode-rail-paddle[data-dir=prev]");
  for (let i = 0; i < 10 && (await rail.evaluate((el) => el.scrollLeft)) > 4; i++) {
    await prev.click();
    await app.waitForTimeout(600);
  }
  expect(await rail.evaluate((el) => el.scrollLeft)).toBeLessThanOrEqual(4);
  await expect(prev).toHaveCSS("opacity", "0");

  // The arrow keys step card by card from the one playing, each brought into view.
  await expect(rail.locator('[aria-current="true"] > .episode-rail-main')).toBeFocused();
  for (let i = 0; i < 9; i++) await app.keyboard.press("ArrowRight");
  await expect(last.locator(".episode-rail-main")).toBeFocused();
  await expect.poll(lastShown).toBe(true);

  // List in the player: seasons and episodes as columns, remembered on the title page.
  await app.getByRole("radio", { name: "List" }).click();
  await expect(rail).toHaveCount(0);
  await expect(app.getByRole("radiogroup", { name: "Episodes" }).getByRole("radio")).toHaveCount(10);
  await app.keyboard.press("Escape");
  await app.keyboard.press("Escape");
  await expect(app.locator(".player")).toHaveCount(0);
  await expect(app.locator(".episode-list")).toBeVisible();
  // And back to a row from the title page, which the player follows.
  await app.getByRole("radio", { name: "Row" }).click();
  await expect(app.locator(".episode-list")).toHaveCount(0);
  await app.locator(".episode-card-main:not([disabled])").first().click();
  await app.getByRole("button", { name: "Episodes", exact: true }).click();
  await expect(rail).toBeVisible();
});
