import { describe, expect, test } from "bun:test";
import {
  addonCatalogs,
  addonHomeCatalogs,
  browsable,
  catalogExtra,
  catalogKey,
  catalogTitle,
  homeCatalogs,
  homeReady,
  readHomeCatalogs,
  searchable,
  withAddonOnHome,
  withCatalogMoved,
  writeHomeCatalogs,
  type AddonCatalog,
} from "../src/lib/catalog/addonCatalogs";
import type { InstalledAddon, ManifestCatalog } from "../src/lib/types";

const addon = (id: string, catalogs: unknown[] | undefined, name = `Addon ${id}`): InstalledAddon => ({
  manifestUrl: `https://${id}.example.com/manifest.json`,
  manifest: { id, version: "1.0.0", name, types: ["movie", "series"], resources: ["catalog"], catalogs: catalogs as ManifestCatalog[] },
});

const lists = addon("lists", [
  { type: "movie", id: "picks", name: "Picks", extra: [{ name: "genre", options: ["Drama", "Comedy"] }, { name: "skip" }] },
  { type: "series", id: "weekend", name: "Weekend" },
  { type: "movie", id: "by-genre", name: "By Genre", extra: [{ name: "genre", options: ["Drama"], isRequired: true }] },
  { type: "movie", id: "find", name: "Find", extra: [{ name: "search", isRequired: true }] },
  { type: "movie", id: "by-year", name: "By Year", extra: [{ name: "year", isRequired: true }] },
  { type: "movie", id: "genre-no-options", extra: [{ name: "genre", isRequired: true }] },
]);
const streams = addon("streams", [{ type: "movie", id: "top", name: "Top", extra: [{ name: "search" }] }]);
const all = addonCatalogs([lists, streams]);
const byId = (id: string, addonId = "lists") => all.find((c) => c.id === id && c.addon === addonId)!;

describe("manifest catalogs (#206)", () => {
  test("reads each catalog's extras: options, required ones, paging and search", () => {
    const picks = byId("picks");
    expect(picks).toMatchObject({
      addon: "lists",
      addonName: "Addon lists",
      type: "movie",
      name: "Picks",
      genres: ["Drama", "Comedy"],
      genreRequired: false,
      pages: true,
      search: false,
    });
    expect(byId("by-genre")).toMatchObject({ genres: ["Drama"], genreRequired: true, pages: false });
    expect(byId("find")).toMatchObject({ search: true, searchRequired: true });
    expect(byId("by-year").unusable).toBe(true);
    expect(byId("genre-no-options")).toMatchObject({ name: "genre-no-options", genres: [], genreRequired: true });
  });

  test("leaves out types Polarity has no pages for, malformed entries and repeats; keeps add-on then manifest order", () => {
    const odd = addon("odd", [
      { type: "channel", id: "radio" },
      { type: "movie" },
      { type: "movie", id: "  " },
      "nonsense",
      null,
      { type: "series", id: "a", extra: "not a list" },
      { type: "series", id: "a", name: "Again" },
      { type: "movie", id: "b", extra: [{ name: "" }, { options: ["x"] }, { name: "genre", options: ["Drama", 3, ""] }] },
    ]);
    const found = addonCatalogs([odd, addon("none", undefined)]);
    expect(found.map((c) => [c.type, c.id])).toEqual([
      ["series", "a"],
      ["movie", "b"],
    ]);
    expect(found[0].name).toBe("a");
    expect(found[1].genres).toEqual(["Drama"]);
    expect(all.map((c) => c.addon + "/" + c.id).slice(-2)).toEqual(["lists/genre-no-options", "streams/top"]);
  });

  test("where each catalog can go", () => {
    const where = (c: AddonCatalog) => [homeReady(c), browsable(c), searchable(c)];
    expect(where(byId("picks"))).toEqual([true, true, false]);
    expect(where(byId("weekend"))).toEqual([true, true, false]);
    // A required genre: Discover picks one, Home and search can't.
    expect(where(byId("by-genre"))).toEqual([false, true, false]);
    expect(where(byId("genre-no-options"))).toEqual([false, false, false]);
    expect(where(byId("find"))).toEqual([false, false, true]);
    expect(where(byId("by-year"))).toEqual([false, false, false]);
    expect(where(byId("top", "streams"))).toEqual([true, true, true]);
  });

  test("a request carries only the extras the catalog declares", () => {
    expect(catalogExtra(byId("picks"), { genre: "Drama", skip: 8, search: "x" })).toEqual([
      ["genre", "Drama"],
      ["skip", "8"],
    ]);
    expect(catalogExtra(byId("picks"), { skip: 0 })).toEqual([]);
    expect(catalogExtra(byId("weekend"), { genre: "Drama", skip: 8 })).toEqual([]);
    expect(catalogExtra(byId("by-genre"), {})).toEqual([["genre", "Drama"]]);
    expect(catalogExtra(byId("find"), { search: "lighthouse" })).toEqual([["search", "lighthouse"]]);
  });

  test("a row's title names the catalog and the add-on", () => {
    expect(catalogTitle(byId("picks"))).toBe("Picks · Addon lists");
  });
});

describe("Home rows from add-on catalogs (#206)", () => {
  const none = readHomeCatalogs("");

  test("new add-ons' catalogs are off: nothing on Home until switched on", () => {
    expect(none).toEqual({ on: [], order: [] });
    expect(homeCatalogs(all, none)).toEqual([]);
  });

  test("switching an add-on on adds its Home-ready catalogs, in manifest order; off removes them", () => {
    const on = withAddonOnHome(none, "lists", true);
    expect(homeCatalogs(all, on).map((c) => c.id)).toEqual(["picks", "weekend"]);
    expect(homeCatalogs(all, withAddonOnHome(on, "lists", false))).toEqual([]);
    expect(withAddonOnHome(on, "lists", true).on).toEqual(["lists"]);
  });

  test("add-ons follow their installed order, whatever order they were switched on in", () => {
    const both = withAddonOnHome(withAddonOnHome(none, "streams", true), "lists", true);
    expect(homeCatalogs(all, both).map((c) => `${c.addon}/${c.id}`)).toEqual(["lists/picks", "lists/weekend", "streams/top"]);
  });

  test("moving a catalog reorders it among its add-on's; the ends don't move further", () => {
    const on = withAddonOnHome(none, "lists", true);
    const weekend = byId("weekend");
    const moved = withCatalogMoved(all, on, weekend, -1);
    expect(addonHomeCatalogs(all, moved, "lists").map((c) => c.id)).toEqual(["weekend", "picks"]);
    expect(withCatalogMoved(all, moved, weekend, -1)).toBe(moved);
    const back = withCatalogMoved(all, moved, weekend, 1);
    expect(addonHomeCatalogs(all, back, "lists").map((c) => c.id)).toEqual(["picks", "weekend"]);
    // Another add-on's order is left as it was.
    const other = withCatalogMoved(all, { ...moved, order: ["x", ...moved.order] }, byId("picks"), 1);
    expect(other.order[0]).toBe("x");
  });

  test("a catalog the add-on added since keeps its manifest place after the ordered ones", () => {
    const setting = { on: ["lists"], order: [catalogKey(byId("weekend"))] };
    expect(homeCatalogs(all, setting).map((c) => c.id)).toEqual(["weekend", "picks"]);
  });

  test("the stored form reads back, and anything else reads as nothing switched on", () => {
    const s = withCatalogMoved(all, withAddonOnHome(none, "lists", true), byId("weekend"), -1);
    expect(readHomeCatalogs(writeHomeCatalogs(s))).toEqual(s);
    for (const bad of ["{", "null", "[]", '{"on":"lists","order":[1,"k"]}']) expect(readHomeCatalogs(bad).on).toEqual([]);
    expect(readHomeCatalogs('{"on":["a",2],"order":[1,"k"]}')).toEqual({ on: ["a"], order: ["k"] });
  });
});
