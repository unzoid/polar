import { ToggleChip } from "../../components/ui/Chip";
import { TextField } from "../../components/ui/TextField";
import { useEffect, useState } from "react";
import { Dropdown } from "../../components/Dropdown";
import { ANIME_SHELVES, setShelfVisible, useShelfVisible } from "../../lib/anime/shelves";
import { preferredGroups } from "../../lib/anime/groups";
import { setPrefs, usePrefs } from "../../lib/prefs";
import { Button } from "../../components/ui/Button";
import { Card, PickRow, ToggleRow } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";

/** The Anime section's own preferences (kept in prefs, and follow the profile). With it off, there's only the switch. */
export function AnimePage() {
  const prefs = usePrefs();
  const shelfVisible = useShelfVisible();
  const [groups, setGroups] = useState(prefs.animePreferredGroups);
  useEffect(() => setGroups(prefs.animePreferredGroups), [prefs.animePreferredGroups]);
  // Saved tidy: one ", " between groups, so the box shows what's in effect.
  const tidyGroups = preferredGroups(groups).join(", ");
  const section = (
    <Card footer={prefs.animeEnabled ? undefined : "Your watch history and saved titles stay as they are."}>
      <SettingRow id="animeEnabled" />
    </Card>
  );
  if (!prefs.animeEnabled) return section;
  return (
    <>
      {section}
      <Card title="Language">
        <SettingRow id="animeTitles" />
        <PickRow title="Voice actors" caption="Whose voices to list beside the characters">
          <Dropdown
            label="Voice actors"
            value={prefs.animeVoices}
            onChange={(v) => setPrefs({ animeVoices: v })}
            options={[
              { value: "japanese", label: "Japanese" },
              { value: "english", label: "English" },
            ]}
          />
        </PickRow>
      </Card>
      <Card title="Shelves" footer="What the Anime page shows, top to bottom, in desktop and TV mode. Featured is the carousel at the top; Genres adds a shelf for each genre.">
        <div className="settings-row settings-chip-row">
          <div className="srcf-tags" role="group" aria-label="Shelves on the Anime page">
            {ANIME_SHELVES.map((s) => {
              const on = shelfVisible(s.id);
              return (
                <ToggleChip key={s.id} on={on} label={s.label} onToggle={() => setShelfVisible(s.id, !on)} />
              );
            })}
          </div>
        </div>
      </Card>
      <Card title="Cards">
        <SettingRow id="animeCardScores" />
        <SettingRow id="animeScoreFormat" />
        <SettingRow id="animeCardCountdown" />
      </Card>
      <Card title="Schedule">
        <ToggleRow
          title="List every show"
          caption="Include the shorts and regional shows most people aren't following"
          checked={prefs.animeScheduleAll}
          onChange={(v) => setPrefs({ animeScheduleAll: v })}
        />
      </Card>
      <Card title="Episodes" footer="Blurring unwatched pictures and hiding their descriptions are under Browsing → Spoilers, and apply here too.">
        <ToggleRow
          title="Skip filler episodes"
          caption="Next Episode and autoplay pass over episodes marked as filler. They stay in the list, marked Filler"
          checked={prefs.animeSkipFiller}
          onChange={(v) => setPrefs({ animeSkipFiller: v })}
        />
        <ToggleRow
          title="Hide recap episodes"
          caption="Leave episodes MyAnimeList marks as recaps out of the list"
          checked={prefs.animeHideRecaps}
          onChange={(v) => setPrefs({ animeHideRecaps: v })}
        />
        <ToggleRow
          title="Hide 4K sources"
          caption="Anime is almost never made in 4K: nearly all of those releases are AI upscales of the 1080p master"
          checked={prefs.animeNo4k}
          onChange={(v) => setPrefs({ animeNo4k: v })}
        />
        <ToggleRow
          title="Show spoiler tags"
          caption="Tags that give away the story, on an anime's Details"
          checked={prefs.animeSpoilerTags}
          onChange={(v) => setPrefs({ animeSpoilerTags: v })}
        />
      </Card>
      <Card
        title="Preferred Release Groups"
        footer="Their sources go to the top of an anime's source list and are what autoplay picks first, in the order you list them. Separate with commas. Filters and other sorts still apply."
      >
        <form
          className="settings-row"
          onSubmit={(e) => {
            e.preventDefault();
            setPrefs({ animePreferredGroups: tidyGroups });
            setGroups(tidyGroups);
          }}
        >
          <TextField
            placeholder="Group A, Group B"
            value={groups}
            onChange={setGroups}
            spellCheck={false}
            aria-label="Preferred release groups"
          />
          <Button variant="primary" disabled={tidyGroups === prefs.animePreferredGroups}>
            Save
          </Button>
        </form>
      </Card>
    </>
  );
}
