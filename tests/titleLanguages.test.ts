import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import "./storageStub";
import { getPrefs } from "../src/lib/settings/prefs";
import { choicesOf, readSetting, settingDef } from "../src/lib/settings/schema";
import { autoPickOrder, defaultFilter } from "../src/lib/playback/sources";
import { NEUTRAL, scoreSources } from "../src/lib/playback/bestMatch";
import { rememberLanguage, settingsForTitle, titleIdOf, titleLanguages } from "../src/lib/playback/titleLanguages";
import type { RankedStream, Settings } from "../src/lib/types";

// autoPickOrder asks for this screen's resolution. Only while these tests run: a `window` left behind
// makes later files in the same run (PGlite's) take Bun for a browser.
const g = globalThis as { window?: unknown };
const before = g.window;
beforeAll(() => {
  g.window ??= { screen: { width: 1920, height: 1080 }, devicePixelRatio: 1 };
});
afterAll(() => {
  if (before === undefined) delete g.window;
  else g.window = before;
});

// Only what these tests read; the rest of Settings doesn't matter here.
const FIXTURE_SETTINGS = { language: "en-US", animeAudioLanguage: "same", animeSubtitleLanguage: "same" } as Settings;

// English for everything, Japanese audio with English subtitles for anime.
const split: Settings = { ...FIXTURE_SETTINGS, audioLanguage: "en", subtitleLanguage: "", animeAudioLanguage: "ja", animeSubtitleLanguage: "en" };
const same: Settings = { ...split, animeAudioLanguage: "same", animeSubtitleLanguage: "same" };

const source = (name: string, languages: string[]): RankedStream => ({
  addon: "Open Films",
  stream: { url: `https://media.example.com/${name}.mkv`, name: "Open Films", title: name },
  quality: { resolution: 1080, hdr: false, dolbyVision: false, lowQualitySource: false, direct: true, languages, tags: [] },
  score: 0,
  label: name,
});
const dubbed = source("Tower.of.Glass.S01E01.1080p.DUB", ["en"]);
const original = source("Tower.of.Glass.S01E01.1080p", ["ja"]);
const italian = source("Night.Ferry.1080p.ITA", ["it"]);

describe("the languages a title plays with", () => {
  test("an anime takes Settings → Anime's", () => {
    expect(titleLanguages(split, true)).toEqual({ audio: "ja", subtitle: "en" });
  });
  test("a series that isn't anime takes Subtitles & Audio's", () => {
    expect(titleLanguages(split, false)).toEqual({ audio: "en", subtitle: "" });
  });
  test("a film takes Subtitles & Audio's", () => {
    expect(titleLanguages({ ...split, audioLanguage: "it", subtitleLanguage: "it" }, false)).toEqual({ audio: "it", subtitle: "it" });
  });
  test("Same as other titles: an anime follows Subtitles & Audio", () => {
    expect(titleLanguages(same, true)).toEqual({ audio: "en", subtitle: "" });
    // Settings saved before #235 have no anime languages at all.
    const older = { ...split } as Partial<Settings>;
    delete older.animeAudioLanguage;
    delete older.animeSubtitleLanguage;
    expect(titleLanguages(older as Settings, true)).toEqual({ audio: "en", subtitle: "" });
  });
  test("Original language: the one the title's details give, else Japanese", () => {
    const orig = { ...split, animeAudioLanguage: "original" };
    expect(titleLanguages(orig, true, "ko").audio).toBe("ko");
    expect(titleLanguages(orig, true).audio).toBe("ja");
  });
  test("an anime's own Default and Off mean what they say, not Same as other titles", () => {
    expect(titleLanguages({ ...split, animeAudioLanguage: "", animeSubtitleLanguage: "" }, true)).toEqual({ audio: "", subtitle: "" });
  });
  test("other settings pass through untouched", () => {
    const anime = settingsForTitle(split, true)!;
    expect({ ...anime, audioLanguage: "en", subtitleLanguage: "" }).toEqual(split);
    expect(settingsForTitle(split, false)).toBe(split);
  });
});

describe("the source list and auto-pick", () => {
  const anime = [dubbed, original];
  test("an anime's list opens on its own audio language", () => {
    expect(defaultFilter(anime, settingsForTitle(split, true)).lang).toBe("ja");
    expect(autoPickOrder([dubbed, original], settingsForTitle(split, true))[0]).toBe(original);
  });
  test("a series or film opens on Subtitles & Audio's", () => {
    const it = { ...split, audioLanguage: "it" };
    expect(defaultFilter([dubbed, italian], settingsForTitle(it, false)).lang).toBe("it");
    expect(autoPickOrder([dubbed, italian], settingsForTitle(it, false))[0]).toBe(italian);
  });
  test("Same as other titles: an anime's list opens as any other's", () => {
    const it = { ...same, audioLanguage: "it" };
    expect(defaultFilter([original, italian], settingsForTitle(it, true)).lang).toBe("it");
  });
});

describe("Best Match", () => {
  // useMatchContext takes audioLanguage from the settings it's given: useTitleSettings' for the title.
  const best = (settings: Settings, anime: boolean, list: RankedStream[]) => {
    const scores = scoreSources(list, { ...NEUTRAL, audioLanguage: settingsForTitle(settings, anime)!.audioLanguage });
    return [...list].sort((a, b) => scores.get(b)!.score - scores.get(a)!.score)[0];
  };
  test("an anime's own audio language counts for an anime", () => {
    expect(best(split, true, [dubbed, original])).toBe(original);
  });
  test("a series or film goes by Subtitles & Audio's", () => {
    expect(best(split, false, [original, dubbed])).toBe(dubbed);
  });
  test("Same as other titles: an anime goes by Subtitles & Audio's too", () => {
    expect(best(same, true, [original, dubbed])).toBe(dubbed);
  });
});

describe("a track picked in the player", () => {
  test("goes to the anime setting while it has its own language", () => {
    expect(rememberLanguage(split, true, undefined, { audioLanguage: "en" })).toEqual({ animeAudioLanguage: "en" });
    expect(rememberLanguage(split, true, undefined, { subtitleLanguage: "" })).toEqual({ animeSubtitleLanguage: "" });
  });
  test("goes to Subtitles & Audio for other titles, and for anime on Same as other titles", () => {
    expect(rememberLanguage(split, false, undefined, { audioLanguage: "ja" })).toEqual({ audioLanguage: "ja" });
    expect(rememberLanguage(same, true, undefined, { audioLanguage: "ja", subtitleLanguage: "en" })).toEqual({ audioLanguage: "ja", subtitleLanguage: "en" });
  });
  test("leaves Original language alone when the pick is the original", () => {
    const orig = { ...split, animeAudioLanguage: "original" };
    expect(rememberLanguage(orig, true, "ko", { audioLanguage: "ko" })).toEqual({});
    expect(rememberLanguage(orig, true, undefined, { audioLanguage: "ja" })).toEqual({});
    expect(rememberLanguage(orig, true, "ko", { audioLanguage: "en" })).toEqual({ animeAudioLanguage: "en" });
  });
});

describe("Settings → Anime", () => {
  test("both start on Same as other titles; audio also offers Original language", () => {
    const audio = settingDef("animeAudioLanguage");
    const subtitle = settingDef("animeSubtitleLanguage");
    const older = { ...FIXTURE_SETTINGS } as Partial<Settings>;
    delete older.animeAudioLanguage;
    delete older.animeSubtitleLanguage;
    for (const def of [audio, subtitle]) {
      expect(readSetting(def, FIXTURE_SETTINGS, getPrefs())).toBe("same");
      expect(readSetting(def, older as Settings, getPrefs())).toBe("same");
    }
    const choices = (id: string, current: string) => {
      const c = settingDef(id).control;
      if (c?.kind !== "choice") throw new Error(id);
      return choicesOf(c, current).map((x) => x.value);
    };
    expect(choices("animeAudioLanguage", "same").slice(0, 3)).toEqual(["same", "original", ""]);
    expect(choices("animeSubtitleLanguage", "same").slice(0, 2)).toEqual(["same", ""]);
    // A language outside the usual list stays selectable, once.
    expect(choices("animeAudioLanguage", "tl").filter((v) => v === "tl")).toEqual(["tl"]);
  });
});

test("a video's title id", () => {
  expect(titleIdOf("tt0000000:1:2")).toBe("tt0000000");
  expect(titleIdOf("kitsu:12:3")).toBe("kitsu:12");
  expect(titleIdOf("tt0000000")).toBe("tt0000000");
});
