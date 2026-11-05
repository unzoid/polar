import { afterEach, describe, expect, test } from "bun:test";
import { onSaveFailure, saveFailureText, storeLocal } from "../src/lib/errors";

// api.ts reaches modules that read localStorage when they load.
const mem = new Map<string, string>();
(globalThis as { localStorage?: unknown }).localStorage ??= {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
};
const { api } = await import("../src/lib/api");
const { keys, queryClient } = await import("../src/lib/net");

// The native side answers through window.__TAURI_INTERNALS__ (what @tauri-apps/api's invoke calls).
const g = globalThis as { window?: unknown };
function nativeAnswers(answer: (cmd: string) => unknown) {
  g.window = { __TAURI_INTERNALS__: { invoke: async (cmd: string) => answer(cmd) } };
}
afterEach(() => {
  delete g.window;
});

describe("save failures are never silent (test report 1, item 3)", () => {
  test("a command that couldn't save tells the app, and the data it may have changed is read again", async () => {
    nativeAnswers(() => {
      throw { code: "save_failed", message: "could not save: not saved: C:\\x\\polar.json couldn't be read (Access is denied.)" };
    });
    const heard: string[] = [];
    const off = onSaveFailure((m) => heard.push(m));
    queryClient.setQueryData(keys.library, []);
    await expect(api.toggleLibrary({ id: "tt1", type: "series", name: "X" })).rejects.toMatchObject({ code: "save_failed" });
    off();
    expect(heard).toEqual(["C:\\x\\polar.json couldn't be read (Access is denied.)"]);
    expect(queryClient.getQueryState(keys.library)?.isInvalidated).toBe(true);
  });

  test("other failures are left to the caller", async () => {
    nativeAnswers(() => {
      throw { code: "network", message: "offline" };
    });
    const heard: string[] = [];
    const off = onSaveFailure((m) => heard.push(m));
    await expect(api.addons()).rejects.toMatchObject({ code: "network" });
    off();
    expect(heard).toEqual([]);
  });

  test("the message drops the wrapper words", () => {
    expect(saveFailureText("could not save: disk full")).toBe("disk full");
    expect(saveFailureText("Couldn't create the downloads folder: denied")).toBe("Couldn't create the downloads folder: denied");
  });

  test("a full or refused browser store is reported, not thrown", () => {
    const heard: string[] = [];
    const off = onSaveFailure((m) => heard.push(m));
    const full = {
      setItem: () => {
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      },
    };
    expect(storeLocal("k", "v", full)).toBe(false);
    expect(storeLocal("k", "v", { setItem: () => {} })).toBe(true);
    off();
    expect(heard).toEqual(["The quota has been exceeded."]);
  });
});
