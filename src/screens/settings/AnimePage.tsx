import { ToggleChip } from "../../components/ui/Chip";
import { useEffect, useState } from "react";
import { ANIME_SHELVES, preferredGroups, setShelfVisible, useShelfVisible } from "../../lib/anime";
import { setPrefs, usePrefs } from "../../lib/settings";
import { Card, FormRow } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";

/** The Anime section's own preferences (kept in prefs, and follow the profile). With it off, there's only the switch. */
export function AnimePage() {
  const prefs = usePrefs();
  const shelfVisible = useShelfVisible();
  const [groups, setGroups] = useState(prefs.animePreferredGroups);
  useEffect(() => setGroups(prefs.animePreferredGroups), [prefs.animePreferredGroups]);
  // Saved tidy: one ", " between groups, so the box shows what's in effect.
  const tidyGroups = (g: string) => preferredGroups(g).join(", ");
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
        <SettingRow id="animeVoices" />
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
        <SettingRow id="animeSeparateEntries" />
      </Card>
      <Card title="Schedule">
        <SettingRow id="animeScheduleAll" />
      </Card>
      <Card title="Episodes" footer="Blurring unwatched pictures and hiding their descriptions are under Browsing → Spoilers, and apply here too.">
        <SettingRow id="animeSkipFiller" />
        <SettingRow id="animeHideRecaps" />
        <SettingRow id="animeNo4k" />
        <SettingRow id="animeSpoilerTags" />
      </Card>
      <Card
        title="Preferred Release Groups"
        footer="Their sources score higher in Best Match, the first group you list most, so autoplay usually picks them first. A much better file from another group can still come first. Separate with commas. Filters and other sorts still apply."
      >
        <FormRow
          placeholder="Group A, Group B"
          aria-label="Preferred release groups"
          value={groups}
          onChange={setGroups}
          saved={prefs.animePreferredGroups}
          tidy={tidyGroups}
          onSubmit={(g) => {
            setPrefs({ animePreferredGroups: g });
            setGroups(g);
          }}
        />
      </Card>
    </>
  );
}
