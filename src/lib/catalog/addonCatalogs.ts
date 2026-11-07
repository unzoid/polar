import type { CatalogExtra, ContentType, InstalledAddon } from "../types";

/**
 * Add-on catalogs (#206): the lists of titles an installed add-on declares in its manifest
 * (`catalogs`), read once here so Home, Discover, search and Settings → Add-ons agree on which
 * list can go where. A catalog is a list of titles and nothing more: it never touches sources.
 *
 * Its extras say what a request may carry: `genre` (with the genres it knows as options),
 * `skip` (paging) and `search`. One that requires an extra can only be shown where that extra
 * is given: a required genre in Discover (a genre is always picked), a required search in
 * search. A required extra of any other kind keeps the catalog out everywhere.
 */
export interface AddonCatalog {
  /** The add-on's manifest id. */
  addon: string;
  addonName: string;
  type: ContentType;
  id: string;
  /** The catalog's own name, else its id. */
  name: string;
  /** Takes a `genre`. */
  genre: boolean;
  /** The `genre` extra's options; empty when it has none or no genre extra. */
  genres: string[];
  genreRequired: boolean;
  /** Pages with `skip`. Without it the first answer is the whole list. */
  pages: boolean;
  search: boolean;
  searchRequired: boolean;
  /** A required extra Polarity can't give (anything but genre and search). */
  unusable: boolean;
}

const TYPES: readonly string[] = ["movie", "series"] satisfies ContentType[];
const KNOWN = ["genre", "skip", "search"];
const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

function extras(raw: unknown): CatalogExtra[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((e): CatalogExtra[] => {
    const name = text((e as CatalogExtra)?.name);
    if (!name) return [];
    const options = (e as CatalogExtra).options;
    return [
      {
        name,
        options: Array.isArray(options) ? options.filter((o): o is string => !!text(o)) : undefined,
        isRequired: (e as CatalogExtra).isRequired === true,
      },
    ];
  });
}

/** Every catalog of the installed add-ons, in their order, then each manifest's. Movie and series lists only: those are the pages Polarity has. */
export function addonCatalogs(addons: readonly InstalledAddon[]): AddonCatalog[] {
  const seen = new Set<string>();
  const out: AddonCatalog[] = [];
  for (const { manifest } of addons) {
    if (!Array.isArray(manifest.catalogs)) continue;
    for (const raw of manifest.catalogs) {
      const id = text(raw?.id);
      const type = raw?.type;
      if (!id || !TYPES.includes(type)) continue;
      const extra = extras(raw.extra);
      const find = (name: string) => extra.find((e) => e.name === name);
      const catalog: AddonCatalog = {
        addon: manifest.id,
        addonName: manifest.name,
        type: type as ContentType,
        id,
        name: text(raw.name) ?? id,
        genre: !!find("genre"),
        genres: find("genre")?.options ?? [],
        genreRequired: !!find("genre")?.isRequired,
        pages: !!find("skip"),
        search: !!find("search"),
        searchRequired: !!find("search")?.isRequired,
        unusable: extra.some((e) => e.isRequired && !KNOWN.includes(e.name)) || !!find("skip")?.isRequired,
      };
      const key = catalogKey(catalog);
      if (!seen.has(key)) out.push(catalog);
      seen.add(key);
    }
  }
  return out;
}

/** One string per catalog: add-on, type and id. */
export const catalogKey = (c: Pick<AddonCatalog, "addon" | "type" | "id">) => JSON.stringify([c.addon, c.type, c.id]);

/** "Staff Picks · Example Lists": the catalog's name and the add-on's. */
export const catalogTitle = (c: AddonCatalog) => `${c.name} · ${c.addonName}`;

/** Can be a Home row: needs nothing it isn't given (a required genre picks nothing on Home). */
export const homeReady = (c: AddonCatalog) => !c.unusable && !c.genreRequired && !c.searchRequired;

/** Can be browsed in Discover: a required genre is fine when it lists the genres to pick from. */
export const browsable = (c: AddonCatalog) => !c.unusable && !c.searchRequired && (!c.genreRequired || c.genres.length > 0);

/** Answers searches. */
export const searchable = (c: AddonCatalog) => c.search && !c.unusable && !c.genreRequired;

/** The extra arguments of one request, only those the catalog declares (the backend refuses others). */
export function catalogExtra(c: AddonCatalog, want: { genre?: string; skip?: number; search?: string }): [string, string][] {
  const out: [string, string][] = [];
  if (want.search && c.search) out.push(["search", want.search]);
  const genre = want.genre ?? (c.genreRequired ? c.genres[0] : undefined);
  if (genre && c.genre) out.push(["genre", genre]);
  if (want.skip && c.pages) out.push(["skip", String(want.skip)]);
  return out;
}

// --- Home rows, Settings → Add-ons --------------------------------------

/**
 * Which add-ons' catalogs show on Home, and the order the user gave them. Kept as JSON in the
 * synced pref `addonCatalogsHome`. An add-on not in `on` shows none: new ones start off, so
 * installing a stream add-on doesn't change Home.
 */
export interface HomeCatalogs {
  on: string[];
  /** Catalog keys in the order chosen; ones not listed follow in manifest order. */
  order: string[];
}

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

export function readHomeCatalogs(stored: string): HomeCatalogs {
  try {
    const v = JSON.parse(stored) as Partial<HomeCatalogs>;
    return { on: strings(v?.on), order: strings(v?.order) };
  } catch {
    return { on: [], order: [] };
  }
}

export const writeHomeCatalogs = (s: HomeCatalogs) => JSON.stringify(s);

/** An add-on's catalogs that can be Home rows, in the user's order. */
export function addonHomeCatalogs(catalogs: readonly AddonCatalog[], setting: HomeCatalogs, addon: string): AddonCatalog[] {
  const own = catalogs.filter((c) => c.addon === addon && homeReady(c));
  const at = (c: AddonCatalog) => {
    const i = setting.order.indexOf(catalogKey(c));
    return i < 0 ? setting.order.length + own.indexOf(c) : i;
  };
  return [...own].sort((a, b) => at(a) - at(b));
}

/** Home's add-on rows: each switched-on add-on's catalogs, add-ons in their installed order. */
export function homeCatalogs(catalogs: readonly AddonCatalog[], setting: HomeCatalogs): AddonCatalog[] {
  const addons = [...new Set(catalogs.map((c) => c.addon))].filter((a) => setting.on.includes(a));
  return addons.flatMap((a) => addonHomeCatalogs(catalogs, setting, a));
}

export function withAddonOnHome(setting: HomeCatalogs, addon: string, on: boolean): HomeCatalogs {
  const rest = setting.on.filter((a) => a !== addon);
  return { ...setting, on: on ? [...rest, addon] : rest };
}

/** Moves one of an add-on's catalogs up (-1) or down (1) among its others; the add-on's whole order is written. */
export function withCatalogMoved(catalogs: readonly AddonCatalog[], setting: HomeCatalogs, catalog: AddonCatalog, by: -1 | 1): HomeCatalogs {
  const list = addonHomeCatalogs(catalogs, setting, catalog.addon).map(catalogKey);
  const from = list.indexOf(catalogKey(catalog));
  const to = from + by;
  if (from < 0 || to < 0 || to >= list.length) return setting;
  [list[from], list[to]] = [list[to], list[from]];
  const others = setting.order.filter((k) => !list.includes(k));
  return { ...setting, order: [...others, ...list] };
}
