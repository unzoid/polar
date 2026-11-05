/**
 * Smoke test of the real app through tauri-driver (WebDriver), run by the
 * e2e-app workflow nightly and on master (docs/testing.md). Unlike e2e/*.spec.ts
 * this drives the built shell: Rust, the store on disk and the web view.
 *
 *   bunx tauri build --debug --no-bundle
 *   bun e2e/app/smoke.ts
 *
 * Needs `tauri-driver` (cargo install tauri-driver --locked) and the platform's
 * driver: WebKitWebDriver on Linux (apt webkit2gtk-driver, under xvfb-run
 * without a display), msedgedriver matching WebView2 on Windows. macOS has no
 * WKWebView driver.
 *
 * Steps: start without an account, turn Skip intros on in Settings, add a
 * title to the Library through the command bridge, quit with the window's Close
 * button, start again and find both still there.
 *
 * On Linux the app's data goes to a fresh folder (XDG_* variables). On Windows
 * it can't be moved, so it runs only on CI or with POLAR_E2E_APP_OK=1, and then
 * writes into your own Polar profile.
 *
 * POLAR_APP=<path> picks the binary (default target/debug/polar[.exe]);
 * TAURI_DRIVER=<path> the driver (default tauri-driver on PATH).
 */
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readdirSync, readlinkSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const windows = process.platform === "win32";
const PORT = 4444;
const BASE = `http://127.0.0.1:${PORT}`;
const ELEMENT = "element-6066-11e4-a52e-4f735466cecf";
const app = resolve(process.env.POLAR_APP ?? join("target", "debug", windows ? "polar.exe" : "polar"));
const TITLE = { id: "tt9999990", type: "movie", name: "Polar Smoke Test" };

type Ref = { [ELEMENT]: string };

if (windows && !process.env.CI && !process.env.POLAR_E2E_APP_OK) {
  console.error("On Windows this writes into your own Polar profile; set POLAR_E2E_APP_OK=1 to run it anyway.");
  process.exit(2);
}

async function wd<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    // A command sent while the app quits may never be answered.
    signal: AbortSignal.timeout(60_000),
  });
  const json = (await res.json()) as { value: T & { error?: string; message?: string } };
  if (!res.ok) throw new Error(`${method} ${path}: ${json.value?.error ?? res.status} ${json.value?.message ?? ""}`);
  return json.value;
}

async function until<T>(what: string, probe: () => Promise<T | null | undefined | false>, ms = 30_000): Promise<T> {
  const end = Date.now() + ms;
  let last: unknown;
  while (Date.now() < end) {
    try {
      const v = await probe();
      if (v) return v;
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`timed out waiting for ${what}${last ? ` (${last})` : ""}`);
}

class Session {
  constructor(readonly id: string) {}

  static async start() {
    const v = await wd<{ sessionId: string }>("POST", "/session", {
      capabilities: { alwaysMatch: { "tauri:options": { application: app } } },
    });
    return new Session(v.sessionId);
  }

  run<T>(script: string, ...args: unknown[]) {
    return wd<T>("POST", `/session/${this.id}/execute/sync`, { script, args });
  }

  /** Calls a command through the app's own bridge, as the front end does. */
  invoke<T>(cmd: string, args: Record<string, unknown> = {}) {
    return wd<T>("POST", `/session/${this.id}/execute/async`, {
      script: `const done = arguments[arguments.length - 1];
        window.__TAURI_INTERNALS__.invoke(arguments[0], arguments[1]).then(
          (v) => done({ ok: v }), (e) => done({ err: String(e?.message ?? JSON.stringify(e)) }));`,
      args: [cmd, args],
    }).then((r) => {
      const { ok, err } = r as { ok?: T; err?: string };
      if (err !== undefined) throw new Error(`${cmd}: ${err}`);
      return ok as T;
    });
  }

  /** The first element matching `selector` whose text (or label's text) starts with `text`. */
  find(selector: string, text?: string) {
    return this.run<Ref | null>(
      `const [sel, text] = arguments;
       return [...document.querySelectorAll(sel)].find((el) => {
         if (text == null) return true;
         const own = (el.getAttribute("aria-label") || el.textContent || "").trim();
         const label = (el.closest("label")?.textContent || "").trim();
         return own.startsWith(text) || label.startsWith(text);
       }) ?? null;`,
      selector,
      text ?? null,
    );
  }

  async click(what: string, selector: string, text?: string) {
    const el = await until(what, () => this.find(selector, text));
    await wd("POST", `/session/${this.id}/element/${el[ELEMENT]}/click`, {});
  }

  checked(el: Ref) {
    return this.run<boolean>("return arguments[0].checked", el);
  }

  /** Whether the window still answers: on Windows the sign that the app has gone. */
  answers() {
    return wd("GET", `/session/${this.id}/title`).then(
      () => true,
      () => false,
    );
  }

  /**
   * Quits as someone would, with the window's Close button. The app writes what's still pending
   * (progress waits a second) as it exits; ending the WebDriver session kills it before that.
   * If the app is still there after the click, the button is clicked from the page, then the
   * window closed through the bridge the button uses, and what each said is in the error.
   */
  async quit() {
    const close = await until("the window's Close button", () => this.find(".window-controls button[aria-label=Close]"));
    const gone = async () => (running() ?? (await this.answers())) === false;
    const said: string[] = [];
    const tries: [string, () => Promise<unknown>][] = [
      ["clicked", () => wd("POST", `/session/${this.id}/element/${close[ELEMENT]}/click`, {})],
      ["clicked from the page", () => this.run("arguments[0].click()", close)],
      ["closed through the bridge", () => this.invoke("plugin:window|close", { label: "main" })],
    ];
    for (const [how, act] of tries) {
      // The window can go before the command is answered.
      await act().then(
        () => said.push(`${how}: ok`),
        (e) => said.push(`${how}: ${e instanceof Error ? e.message : e}`),
      );
      if (await until("the app to quit", gone, 10_000).catch(() => false)) {
        // Passes, since what's tested is what survives a restart, but shows on the run's summary.
        if (how !== tries[0][0]) console.log(`::warning::the Close button didn't quit the app; it quit once ${how} (${said.join("; ")})`);
        await wd("DELETE", `/session/${this.id}`).catch(() => {});
        return;
      }
    }
    const proc = running();
    const state = `${proc === null ? "" : `process ${proc ? "running" : "gone"}, `}window ${(await this.answers()) ? "answering" : "gone"}`;
    throw new Error(`timed out waiting for the app to quit (${said.join("; ")}; ${state})`);
  }
}

/**
 * Whether the app's process runs, found by its executable in /proc on Linux: a closed window
 * doesn't tell that the app has written everything and ended. Null elsewhere.
 */
function running(): boolean | null {
  if (process.platform !== "linux") return null;
  const exe = realpathSync(app);
  for (const pid of readdirSync("/proc")) {
    if (!/^\d+$/.test(pid)) continue;
    try {
      if (readlinkSync(`/proc/${pid}/exe`) === exe) return true;
    } catch {
      // Gone meanwhile, or another user's.
    }
  }
  return false;
}

/** From the first screen to the app's sections: without an account if it asks. */
async function enter(s: Session) {
  await until("the first screen", () =>
    s.find("nav[aria-label=Primary], button", "Continue without an account").then((el) => el ?? s.find("nav[aria-label=Primary]")),
  );
  const guest = await s.find("button", "Continue without an account");
  if (guest) await s.click("Continue without an account", "button", "Continue without an account");
  await until("the navigation bar", () => s.find("nav[aria-label=Primary]"));
}

async function skipIntros(s: Session) {
  await s.click("the profile menu", "[aria-label^='Profile:']");
  await s.click("Settings in the menu", "[role=menuitem]", "Settings");
  const sw = await until("the Skip intros switch", () => s.find("input[role=switch]", "Skip intros"));
  return { sw, checked: () => s.checked(sw), close: () => s.click("Close settings", "[aria-label='Close settings']") };
}

const data = windows ? null : mkdtempSync(join(tmpdir(), "polar-e2e-app-"));
const env = data
  ? { ...process.env, XDG_DATA_HOME: join(data, "data"), XDG_CONFIG_HOME: join(data, "config"), XDG_CACHE_HOME: join(data, "cache") }
  : process.env;
const driver: ChildProcess = spawn(process.env.TAURI_DRIVER ?? "tauri-driver", ["--port", String(PORT)], { env, stdio: ["ignore", "inherit", "inherit"] });
const step = (s: string) => console.log(`- ${s}`);

try {
  await until("tauri-driver", () => fetch(`${BASE}/status`).then((r) => r.ok), 20_000);

  let s = await Session.start();
  step("the app opened");
  await enter(s);
  step("in without an account");
  const first = await skipIntros(s);
  if (await first.checked()) throw new Error("Skip intros is on in a fresh profile");
  await wd("POST", `/session/${s.id}/element/${first.sw[ELEMENT]}/click`, {});
  await until("Skip intros to turn on", () => first.checked(), 5_000);
  await first.close();
  step("Skip intros turned on");
  if (!(await s.invoke<boolean>("library_toggle", { item: TITLE }))) throw new Error("library_toggle removed the title instead of adding it");
  step("a title added to the Library");
  await s.quit();
  step("quit");

  s = await Session.start();
  step("the app opened again");
  await enter(s);
  const again = await skipIntros(s);
  if (!(await again.checked())) throw new Error("Skip intros was off after a restart");
  await again.close();
  step("Skip intros still on");
  const library = await s.invoke<{ id: string }[]>("library_list");
  if (!library.some((i) => i.id === TITLE.id)) throw new Error(`the Library lost the title: ${JSON.stringify(library.map((i) => i.id))}`);
  await s.click("Library in the navigation bar", "nav[aria-label=Primary] button", "Library");
  await until("the title on the Library page", () => s.run<boolean>("return document.body.innerText.includes(arguments[0])", TITLE.name));
  step("the title still in the Library");
  await s.quit();
  console.log("smoke test passed");
} catch (e) {
  console.error(`smoke test failed: ${e instanceof Error ? e.message : e}`);
  process.exitCode = 1;
} finally {
  driver.kill();
  if (data) rmSync(data, { recursive: true, force: true });
}
