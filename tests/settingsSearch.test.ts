import "./storageStub";
import { expect, test } from "bun:test";
import { PAGE_IDS, PAGE_LABELS } from "../src/lib/settings/pages";
import { searchSettings } from "../src/lib/settings/searchIndex";

const search = (q: string) => searchSettings(q, (id) => PAGE_LABELS[id], new Set(PAGE_IDS)).map((e) => `${e.page}:${e.id}`);

test("the AniList link in Services is found by name and by what it does", () => {
  expect(search("anilist")[0]).toBe("services:anilist");
  expect(search("import")).toContain("services:anilist");
  expect(search("sign in")).toContain("services:anilist");
});
