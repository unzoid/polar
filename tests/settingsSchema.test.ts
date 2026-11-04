import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import type { Prefs } from "../src/lib/prefs";
import { SETTINGS, languageChoices, readSetting, settingDef, tvNumberSteps, type Control } from "../src/lib/settings/schema";
import type { Settings } from "../src/lib/types";

const number = (c: Partial<Extract<Control, { kind: "number" }>>) => ({ kind: "number" as const, min: 0, max: 10, ...c });

describe("settings schema", () => {
  test("ids are unique", () => {
    const ids = SETTINGS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("a setting is bound with a control, or neither; only those can be on TV", () => {
    for (const d of SETTINGS) {
      expect([d.id, !!d.bind]).toEqual([d.id, !!d.control]);
      if (d.tv) expect([d.id, !!d.control]).toEqual([d.id, true]);
    }
  });

  // Rows the pages draw themselves are found by their title (or a data-setting mark), so it has to be there.
  test("every unbound title is written in the settings UI", () => {
    const pages = readdirSync("src/screens/settings").map((f) => `src/screens/settings/${f}`);
    const files = [
      ...pages,
      "src/components/Marketplace.tsx",
      "src/components/ShortcutSettings.tsx",
      "src/components/player/SubtitleSettings.tsx",
      "src/lib/marketplace.ts",
    ];
    const source = files.map((f) => readFileSync(f, "utf8")).join("\n");
    const shown = (d: (typeof SETTINGS)[number]) =>
      [`"${d.title}"`, `>${d.title}<`, `data-setting="${d.id}"`].some((s) => source.includes(s));
    const missing = SETTINGS.filter((d) => !d.bind && !shown(d)).map((d) => d.title);
    expect(missing).toEqual([]);
  });

  test("settingDef throws on an unknown id", () => {
    expect(() => settingDef("noSuchSetting")).toThrow();
  });
});

describe("readSetting", () => {
  const prefs = { matureContent: "blur" } as Prefs;
  test("falls back for a missing value and for a choice no longer offered", () => {
    expect(readSetting(settingDef("hideCam"), {} as Settings, prefs)).toBe(true);
    expect(readSetting(settingDef("sourceSort"), { sourceSort: "peers" } as unknown as Settings, prefs)).toBe("best");
    expect(readSetting(settingDef("maxResolution"), { maxResolution: 1440 } as Settings, prefs)).toBe(1440);
  });
  test("reads prefs as they are", () => {
    expect(readSetting(settingDef("matureContent"), {} as Settings, prefs)).toBe("blur");
  });
  test("a language not in the list is offered, so it shows", () => {
    expect(languageChoices("eu", "Off").map((c) => c.value).slice(0, 3)).toEqual(["", "eu", "en"]);
    expect(languageChoices("en", "Off").filter((c) => c.value === "en").length).toBe(1);
  });
});

describe("tvNumberSteps", () => {
  test("the minimum, then multiples of the TV step", () => {
    expect(tvNumberSteps(number({ min: 1, max: 20, tvStep: 5 }), 10)).toEqual([1, 5, 10, 15, 20]);
  });
  test("keeps a value set between the steps", () => {
    expect(tvNumberSteps(number({ min: 1, max: 20, tvStep: 5 }), 7)).toEqual([1, 5, 7, 10, 15, 20]);
  });
  test("falls back to the desktop step", () => {
    expect(tvNumberSteps(number({ min: 0, max: 2, step: 0.5 }), 0)).toEqual([0, 0.5, 1, 1.5, 2]);
  });
});
