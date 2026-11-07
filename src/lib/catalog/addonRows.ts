import { useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useMemo } from "react";
import { api } from "../api";
import { keys, useAddons } from "../net/queries";
import { setPrefs, usePrefs } from "../settings/prefs";
import type { MetaPreview } from "../types";
import {
  type AddonCatalog,
  addonCatalogs,
  catalogExtra,
  homeCatalogs,
  readHomeCatalogs,
  searchable,
  writeHomeCatalogs,
  type HomeCatalogs,
} from "./addonCatalogs";

/** Every installed add-on's catalogs (lib/catalog/addonCatalogs.ts). */
export function useAddonCatalogs(): AddonCatalog[] {
  const { data: addons } = useAddons();
  return useMemo(() => addonCatalogs(addons ?? []), [addons]);
}

/** Which add-ons' catalogs are on Home and in what order, and a way to change it (Settings → Add-ons). */
export function useHomeCatalogSetting(): [HomeCatalogs, (next: HomeCatalogs) => void] {
  const { addonCatalogsHome } = usePrefs();
  const setting = useMemo(() => readHomeCatalogs(addonCatalogsHome), [addonCatalogsHome]);
  const set = useCallback((next: HomeCatalogs) => setPrefs({ addonCatalogsHome: writeHomeCatalogs(next) }), []);
  return [setting, set];
}

/** The add-on catalogs Home shows as rows, in order. */
export function useHomeCatalogs(): AddonCatalog[] {
  const catalogs = useAddonCatalogs();
  const [setting] = useHomeCatalogSetting();
  return useMemo(() => homeCatalogs(catalogs, setting), [catalogs, setting]);
}

/** Only what Polarity has pages for; a catalog's items occasionally repeat. */
export function catalogItems(c: AddonCatalog, list: readonly MetaPreview[]): MetaPreview[] {
  const seen = new Set<string>();
  return list.filter((m) => m.type === c.type && !seen.has(m.id) && seen.add(m.id));
}

/**
 * A Home row's titles: the catalog's first page. A failing or slow add-on fails only its own
 * query (the backend gives up after a few seconds), and the row leaves itself out.
 */
export const useAddonCatalogRow = (c: AddonCatalog, enabled = true) =>
  useQuery({
    queryKey: keys.addonCatalog(c.addon, c.type, c.id),
    queryFn: async () => catalogItems(c, await api.addonCatalog(c.addon, c.type, c.id, catalogExtra(c, {}))),
    enabled,
    staleTime: 30 * 60_000,
    retry: false,
  });

/** At most this many add-on catalogs are asked per search, the first in add-on order: a manifest can declare hundreds. */
const MAX_SEARCHED = 12;

/**
 * Every searchable add-on catalog's answer to `query` (empty: none asked), each on its own: a
 * failing add-on's entry has no items. `items` undefined while it's still answering.
 */
export function useAddonSearches(query: string): { catalog: AddonCatalog; items?: MetaPreview[]; failed: boolean }[] {
  const catalogs = useAddonCatalogs().filter(searchable).slice(0, MAX_SEARCHED);
  const results = useQueries({
    queries: catalogs.map((c) => ({
      queryKey: keys.addonSearch(c.addon, c.type, c.id, query),
      queryFn: async () => catalogItems(c, await api.addonCatalog(c.addon, c.type, c.id, catalogExtra(c, { search: query }))),
      enabled: !!query,
      staleTime: 5 * 60_000,
      retry: false,
    })),
  });
  return catalogs.map((catalog, i) => ({ catalog, items: results[i].data, failed: results[i].isError }));
}
