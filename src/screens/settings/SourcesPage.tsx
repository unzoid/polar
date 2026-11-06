import { useQueryClient } from "@tanstack/react-query";
import { ToggleChip } from "../../components/ui/Chip";
import { useEffect, useState } from "react";
import { AUTO_TAG_CHOICES, screenResolution, TAG_LABELS } from "../../lib/playback";
import { keys, useSettings, useUpdateSettings } from "../../lib/net";
import type { Settings as SettingsT } from "../../lib/types";
import { Card, FormRow } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";
import { isDesktop } from "../../lib/platform";

export function SourcesPage() {
  const qc = useQueryClient();
  const { data } = useSettings();
  const update = useUpdateSettings();
  const [words, setWords] = useState("");
  useEffect(() => setWords(data?.excludeKeywords ?? ""), [data?.excludeKeywords]);
  if (!data) return null;
  // Filters run in Rust when sources are fetched, so cached lists are stale.
  const set = (patch: Partial<SettingsT>) =>
    update.mutate(patch, { onSuccess: () => qc.invalidateQueries({ queryKey: keys.streamsAll }) });
  const autoTags = data.sourceAutoTags ?? [];
  const screen = screenResolution();
  const screenLabel = screen >= 2160 ? "4K" : `${screen}p`;

  return (
    <>
      <Card
        title="Filters"
        footer="Hidden sources never play automatically and don't show in the source list. A source that doesn't say its quality or size is always kept."
      >
        <SettingRow id="maxResolution" />
        <SettingRow id="maxMovieSizeGb" />
        <SettingRow id="maxEpisodeSizeGb" />
        <SettingRow id="hideCam" />
      </Card>

      <Card
        title="Hide Sources Containing"
        footer="Separate words with commas, e.g. HC, 3D, KORSUB. Whole words only, upper or lower case."
      >
        <FormRow
          placeholder="HC, 3D, KORSUB"
          aria-label="Words to hide"
          value={words}
          onChange={setWords}
          saved={(data.excludeKeywords ?? "").trim()}
          pending={update.isPending}
          onSubmit={(w) => set({ excludeKeywords: w })}
        />
      </Card>

      <Card title="Source List">
        <SettingRow id="sourceSort" />
        <SettingRow id="preferScreenResolution" caption={`This screen is ${screenLabel}. Best match puts sources it can show first, instead of bigger files it can't`} />
        <SettingRow id="sourceFiltersHide" />
      </Card>

      <Card
        title="Turn On When Available"
        footer="When a title has sources with these, the source list starts filtered to them, and autoplay picks from them first. Click one in the list to turn it off again."
      >
        <div className="settings-row settings-chip-row">
          <div className="srcf-tags" role="group" aria-label="Tags to turn on by themselves">
            {AUTO_TAG_CHOICES.map((t) => {
              const on = autoTags.includes(t);
              return (
                <ToggleChip
                  key={t}
                  on={on}
                  label={TAG_LABELS[t]}
                  onToggle={() => set({ sourceAutoTags: on ? autoTags.filter((x) => x !== t) : [...autoTags, t] })}
                />
              );
            })}
          </div>
        </div>
      </Card>

      {isDesktop && (
        <Card
          title="Torrent Sources"
          footer="Torrent sources your add-ons list play with the built-in engine. Only the file you watch is downloaded, in the order you watch it, into a cache on this device that's emptied when playback ends or Polarity quits. Other peers can see your IP address while a torrent plays."
        >
          <SettingRow id="torrentCacheGb" />
          <SettingRow id="torrentSpeedMbps" />
          <SettingRow id="torrentKeepSharing" />
        </Card>
      )}
    </>
  );
}
