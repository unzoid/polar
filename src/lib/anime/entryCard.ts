import { useMemo } from "react";
import { usePrefs } from "../settings/prefs";
import type { MetaPreview } from "../types";
import { animeEntries, type EntryAt } from "./entries";
import { pickTitle } from "./format";

/**
 * A stored title's card with seasons as separate shows (#22): the name and
 * poster of the AniList entry the episode being watched is part of, and the
 * entry's page to open. As stored when the setting is off or the entry isn't
 * known here (lib/anime/entries.ts). The item keeps its id: the card's menu
 * still acts on the stored title.
 */
export function useEntryShown(item: MetaPreview, videoId: string | undefined): { item: MetaPreview; entry?: EntryAt; opens: string } {
  const { animeEnabled, animeSeparateEntries, animeTitles } = usePrefs();
  return useMemo(() => {
    const entry = animeEnabled && animeSeparateEntries && videoId ? animeEntries.entryAt(videoId) : undefined;
    if (!entry) return { item, opens: item.id };
    const name = pickTitle(entry.title, animeTitles) || item.name;
    return { item: { ...item, name, poster: entry.cover ?? item.poster, logo: undefined }, entry, opens: `anilist:${entry.anilist}` };
  }, [item, videoId, animeEnabled, animeSeparateEntries, animeTitles]);
}
