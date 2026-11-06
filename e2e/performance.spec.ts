import type { CDPSession, Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// Scrolling long pages (#134). Chromium only: these read Chromium's trace and layer tree (WebView2 is Chromium).
// Each budget sits well above what the page needs now and well below what it needed before the fix, so a
// slower runner doesn't trip it and the old problem would.

test.skip(({ browserName }) => browserName !== "chromium", "reads Chromium's trace and layer tree");

type TraceEvent = { name: string; ph: string; pid: number; tid: number; dur?: number; args?: { name?: string; data?: { url?: string } } };

/** The page's main thread while `run` runs: its share of the time busy, and how long each frame's main-thread part took. */
async function mainThread(cdp: CDPSession, run: () => Promise<void>) {
  const events: TraceEvent[] = [];
  const collect = (e: { value: unknown[] }) => void events.push(...(e.value as TraceEvent[]));
  cdp.on("Tracing.dataCollected", collect);
  await cdp.send("Tracing.start", { categories: "devtools.timeline,disabled-by-default-devtools.timeline,cc", transferMode: "ReportEvents" });
  const started = Date.now();
  await run();
  const ms = Date.now() - started;
  const done = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
  await cdp.send("Tracing.end");
  await done;
  cdp.off("Tracing.dataCollected", collect);
  const main = events.find((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain");
  const own = events.filter((e) => e.ph === "X" && e.pid === main?.pid && e.tid === main?.tid);
  // Playwright's own scripts (no URL) aren't the page's work.
  const harness = own.filter((e) => e.name === "EvaluateScript" && !e.args?.data?.url).reduce((a, e) => a + (e.dur ?? 0), 0);
  const busy = own.filter((e) => e.name === "RunTask").reduce((a, e) => a + (e.dur ?? 0), 0) - harness;
  const frames = own
    .filter((e) => e.name === "ProxyMain::BeginMainFrame")
    .map((e) => (e.dur ?? 0) / 1000)
    .sort((a, b) => a - b);
  return { busy: busy / 1000 / ms, medianFrame: frames[Math.floor(frames.length / 2)] ?? 0 };
}

/**
 * How long this machine takes to lay out a fixed block of a few thousand elements (ms): the same kind of
 * main-thread work a frame does. A slower runner takes longer for both, so per-frame budgets are set in
 * multiples of this instead of in milliseconds.
 */
async function layoutUnit(app: Page) {
  return app.evaluate(() => {
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;left:0;top:0;width:600px;visibility:hidden;contain:strict;height:400px";
    for (let i = 0; i < 3000; i++) {
      const s = document.createElement("span");
      s.textContent = `Calibration ${i}`;
      s.style.cssText = "display:inline-block;padding:2px 4px;margin:1px";
      box.append(s);
    }
    document.body.append(box);
    const runs: number[] = [];
    for (let r = 0; r < 9; r++) {
      const t = performance.now();
      box.style.width = `${600 + (r % 2) * 7}px`;
      void box.scrollHeight; // lay it out now
      runs.push(performance.now() - t);
    }
    box.remove();
    runs.sort((a, b) => a - b);
    return runs[Math.floor(runs.length / 2)];
  });
}

async function layerCount(app: Page, cdp: CDPSession) {
  let layers = 0;
  const seen = new Promise<void>((resolve) =>
    cdp.on("LayerTree.layerTreeDidChange", (e: { layers?: unknown[] }) => {
      if (e.layers) layers = e.layers.length;
      resolve();
    }),
  );
  await cdp.send("LayerTree.enable");
  await app.mouse.move(720, 120);
  await seen;
  await app.waitForTimeout(500);
  await cdp.send("LayerTree.disable");
  return layers;
}

test("Home stays light while it sits still and while it scrolls (#134)", async ({ app }) => {
  test.setTimeout(120_000);
  await app.setViewportSize({ width: 1440, height: 900 });
  const cdp = await app.context().newCDPSession(app);
  await expect(app.locator(".row").first()).toBeVisible();
  await app.waitForTimeout(1500);

  // Loading shelves out of view hold their shimmer still.
  const offscreen = await app.evaluate(() => {
    const skeletons = [...document.querySelectorAll(".row[data-offscreen] .skeleton")];
    return { count: skeletons.length, running: skeletons.flatMap((s) => s.getAnimations()).filter((a) => a.playState === "running").length };
  });
  expect.soft(offscreen.count).toBeGreaterThan(0);
  expect.soft(offscreen.running).toBe(0);

  // Nothing moving: the main thread is free (it was busy two thirds of the time redrawing shimmers and the
  // carousel's dot).
  const idle = await mainThread(cdp, () => app.waitForTimeout(2500));
  expect.soft(idle.busy).toBeLessThan(0.15);

  // Every shelf loaded: a few dozen compositor layers, not a few hundred (each shelf's edge blurs were
  // eight layers, shown or not).
  await app.mouse.move(720, 500);
  for (let i = 0; i < 40; i++) {
    await app.mouse.wheel(0, 400);
    await app.waitForTimeout(40);
  }
  await app.waitForTimeout(1500);
  expect.soft(await layerCount(app, cdp)).toBeLessThan(150);

  // Scrolling back up the loaded page: each frame's main-thread part stays small. In units of this machine's
  // speed (layoutUnit), not milliseconds: on a shared CI runner the same page took 16.4 ms where it takes
  // 9.5 here. The median is about 3 units now and 8-10 before #134, also with the CPU throttled 2x.
  await app.mouse.move(720, 500);
  const scrolling = await mainThread(cdp, async () => {
    for (let i = 0; i < 40; i++) {
      await app.mouse.wheel(0, -200);
      await app.waitForTimeout(30);
    }
  });
  const unit = await layoutUnit(app);
  expect.soft(scrolling.medianFrame / unit, `median frame ${scrolling.medianFrame} ms, layout unit ${unit} ms`).toBeLessThan(5);
});
