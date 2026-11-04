import { useQueryClient } from "@tanstack/react-query";
import { Dropdown } from "../../components/Dropdown";
import { useSettings, useUpdateSettings } from "../../lib/queries";
import { setPrefs, usePrefs } from "../../lib/prefs";
import { clearRecentSearches } from "../../lib/recentSearches";
import { Card, PickRow, ToggleRow } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";

const METADATA_LANGUAGES = [
  "en-US", "en-GB", "es-ES", "es-MX", "fr-FR", "de-DE", "it-IT", "pt-PT", "pt-BR", "nl-NL", "sv-SE", "da-DK", "nb-NO",
  "fi-FI", "pl-PL", "cs-CZ", "hu-HU", "ro-RO", "el-GR", "tr-TR", "ru-RU", "uk-UA", "ar-SA", "he-IL", "hi-IN", "th-TH",
  "vi-VN", "id-ID", "ja-JP", "ko-KR", "zh-CN", "zh-TW",
];
const regionNames = new Intl.DisplayNames(undefined, { type: "language" });
const localeLabel = (code: string) => {
  try {
    return regionNames.of(code) ?? code;
  } catch {
    return code;
  }
};

export function BrowsingPage() {
  const qc = useQueryClient();
  const { data } = useSettings();
  const update = useUpdateSettings();
  const prefs = usePrefs();
  if (!data) return null;
  const languages = METADATA_LANGUAGES.includes(data.language) ? METADATA_LANGUAGES : [data.language, ...METADATA_LANGUAGES];
  return (
    <>
      <Card title="General">
        <PickRow title="Open the app on">
          <Dropdown
            label="Open the app on"
            value={data.startPage === "anime" && !prefs.animeEnabled ? "home" : (data.startPage ?? "home")}
            onChange={(v) => update.mutate({ startPage: v })}
            options={[
              { value: "home", label: "Home" },
              { value: "movies", label: "Movies" },
              { value: "series", label: "Shows" },
              ...(prefs.animeEnabled ? [{ value: "anime" as const, label: "Anime" }] : []),
              { value: "library", label: "Library" },
            ]}
          />
        </PickRow>
        <PickRow
          title="Titles and descriptions"
          caption={data.tmdbKey ? "The language of names, synopses and artwork" : "Needs a TMDB key (Services → Artwork and episode info)"}
        >
          <Dropdown
            label="Titles and descriptions"
            value={data.language}
            onChange={(v) =>
              update.mutate(
                { language: v },
                {
                  // A new language rebuilds the catalog source; cached pages are in the old one.
                  onSuccess: () => {
                    for (const k of ["catalog", "discover", "meta", "featured", "recommend"]) qc.invalidateQueries({ queryKey: [k] });
                  },
                },
              )
            }
            options={languages.map((c) => ({ value: c, label: localeLabel(c) }))}
          />
        </PickRow>
      </Card>
      <Card title="Title Pages">
        <SettingRow id="trailerAutoplay" />
        {(data.trailerAutoplay ?? true) && (
          <SettingRow id="trailerSound" />
        )}
      </Card>
      <Card title="Calendar" footer="Like Stremio's calendar: built from the shows in your library and the ones you're watching.">
        <SettingRow id="showCalendar" />
      </Card>
      <Card title="Home">
        <ToggleRow
          title="Rotate the featured titles"
          caption="Move to the next featured title every few seconds"
          checked={data.heroAutoplay ?? true}
          onChange={(v) => update.mutate({ heroAutoplay: v })}
        />
        <SettingRow id="showContinueWatching" />
      </Card>
      <Card title="Spoilers" footer="Episodes you've finished show as normal.">
        <ToggleRow
          title="Blur unwatched episode pictures"
          caption="A still can give away who's in the episode, or what happens"
          checked={!!data.hideEpisodeThumbs}
          onChange={(v) => update.mutate({ hideEpisodeThumbs: v })}
        />
        <ToggleRow
          title="Hide unwatched episode descriptions"
          checked={!!data.hideEpisodeDescriptions}
          onChange={(v) => update.mutate({ hideEpisodeDescriptions: v })}
        />
      </Card>
      <Card title="Family">
        <SettingRow id="matureContent" />
      </Card>
      <Card title="Search">
        <ToggleRow
          title="Suggest genres"
          caption="A few genres under the search field before you type"
          checked={prefs.searchSuggestions}
          onChange={(v) => setPrefs({ searchSuggestions: v })}
        />
        <ToggleRow
          title="Remember recent searches"
          checked={prefs.saveRecentSearches}
          onChange={(v) => {
            setPrefs({ saveRecentSearches: v });
            if (!v) clearRecentSearches();
          }}
        />
      </Card>
      <Card title="Cards">
        <ToggleRow
          title="Show titles"
         
          checked={data.showCardTitles}
          onChange={(v) => update.mutate({ showCardTitles: v })}
        />
        <ToggleRow
          title="Show details"
          caption="Add the type, genre and year under the name"
          checked={data.showCardTitles && data.showCardDetails}
          disabled={!data.showCardTitles}
          onChange={(v) => update.mutate({ showCardDetails: v })}
        />
        <SettingRow id="showCardRatings" />
        {(data.showCardRatings ?? false) && (
          <SettingRow id="cardRatingPosition" />
        )}
        <ToggleRow
          title="Colour-code IMDb ratings"
          caption="Green from 7, amber from 5, red below. Off: every score in IMDb yellow"
          checked={data.ratingColors ?? false}
          onChange={(v) => update.mutate({ ratingColors: v })}
        />
      </Card>
      <Card title="Episodes">
        <PickRow title="Default layout">
          <Dropdown
            label="Episode layout"
            value={data.episodeLayout ?? "row"}
            onChange={(v) => update.mutate({ episodeLayout: v })}
            options={[
              { value: "row", label: "Row" },
              { value: "list", label: "List" },
            ]}
          />
        </PickRow>
      </Card>
    </>
  );
}
