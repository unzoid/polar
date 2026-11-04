import { useQueryClient } from "@tanstack/react-query";
import { ToggleChip } from "../../components/ui/Chip";
import { TextField } from "../../components/ui/TextField";
import { useEffect, useState } from "react";
import { AUTO_TAG_CHOICES, screenResolution, TAG_LABELS } from "../../lib/sources";
import { useSettings, useUpdateSettings } from "../../lib/queries";
import type { Settings as SettingsT } from "../../lib/types";
import { Button } from "../../components/ui/Button";
import { Card, NumberRow } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";

export function SourcesPage() {
  const qc = useQueryClient();
  const { data } = useSettings();
  const update = useUpdateSettings();
  const [words, setWords] = useState("");
  useEffect(() => setWords(data?.excludeKeywords ?? ""), [data?.excludeKeywords]);
  if (!data) return null;
  // Filters run in Rust when sources are fetched, so cached lists are stale.
  const set = (patch: Partial<SettingsT>) =>
    update.mutate(patch, { onSuccess: () => qc.invalidateQueries({ queryKey: ["streams"] }) });
  const wordsDirty = words.trim() !== (data.excludeKeywords ?? "").trim();
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
        <NumberRow
          title="Largest movie file"
          caption="Big files take longer to start and can stall on a slower connection"
          value={data.maxMovieSizeGb ?? 0}
          min={0}
          max={100}
          step={0.5}
          unit="GB"
          zero="Any size"
          onChange={(n) => set({ maxMovieSizeGb: n })}
        />
        <NumberRow
          title="Largest episode file"
          value={data.maxEpisodeSizeGb ?? 0}
          min={0}
          max={30}
          step={0.5}
          unit="GB"
          zero="Any size"
          onChange={(n) => set({ maxEpisodeSizeGb: n })}
        />
        <SettingRow id="hideCam" />
      </Card>

      <Card
        title="Hide Sources Containing"
        footer="Separate words with commas, e.g. HC, 3D, KORSUB. Whole words only, upper or lower case."
      >
        <form
          className="settings-row"
          onSubmit={(e) => {
            e.preventDefault();
            set({ excludeKeywords: words.trim() });
          }}
        >
          <TextField
            placeholder="HC, 3D, KORSUB"
            value={words}
            onChange={setWords}
            spellCheck={false}
            aria-label="Words to hide"
          />
          <Button variant="primary" disabled={!wordsDirty || update.isPending}>
            Save
          </Button>
        </form>
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
    </>
  );
}
