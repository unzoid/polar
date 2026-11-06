import { useQueryClient } from "@tanstack/react-query";
import { setPrefs, usePrefs } from "./prefs";
import { useSettings, useUpdateSettings } from "../net/queries";
import { patchFor, readSetting, settingDef, type SettingDef, type Value } from "./schema";
import type { EpisodeLayout } from "../types";

/**
 * One schema setting's value and its setter, for desktop and TV alike: saves to the setting's
 * store and marks what it makes stale. `value` is undefined until synced settings have loaded.
 */
export function useSetting(id: string): { def: SettingDef; value: Value | undefined; set: (v: Value) => void } {
  const def = settingDef(id);
  const qc = useQueryClient();
  const { data } = useSettings();
  const update = useUpdateSettings();
  const prefs = usePrefs();
  const value = def.bind?.store === "prefs" || data ? readSetting(def, data!, prefs) : undefined;
  const stale = () => def.invalidates?.forEach((queryKey) => qc.invalidateQueries({ queryKey }));

  const set = (v: Value) => {
    const patch = patchFor(def, v);
    if (patch.prefs) {
      setPrefs(patch.prefs);
      stale();
    } else if (patch.settings) update.mutate(patch.settings, { onSuccess: stale });
  };
  return { def, value, set };
}

/**
 * Episodes side by side or as a list (#226): one choice for the title pages and the player, so switching it in one
 * place switches it everywhere, and it's remembered.
 */
export function useEpisodeLayout(): [EpisodeLayout, (layout: EpisodeLayout) => void] {
  const { value, set } = useSetting("episodeLayout");
  return [value === "list" ? "list" : "row", set];
}
