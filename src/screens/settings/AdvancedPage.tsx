import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Reset } from "../../components/icons";
import { Dropdown } from "../../components/Dropdown";
import { api } from "../../lib/api";
import { keys } from "../../lib/queries";
import { resetPrefs, setPrefs, usePrefs } from "../../lib/prefs";
import { Button } from "../../components/ui/Button";
import { Card, ExpandRow, PickRow, ToggleRow, useExpanded, type Expandable } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";

export function AdvancedPage() {
  const prefs = usePrefs();
  const expand = useExpanded();
  const { data: hasMpv } = useQuery({ queryKey: ["mpv"], queryFn: api.mpvAvailable, staleTime: Infinity });
  return (
    <>
      <Card
        title="Video"
        footer={hasMpv === false ? "These need mpv." : "Saved on this device. Changes apply straight away, even mid-video."}
      >
        <ToggleRow
          title="Hardware decoding"
          caption="Lets the graphics card decode video. Turn off only if you see green frames, glitches or a black picture."
          checked={prefs.hwdec}
          disabled={hasMpv === false}
          onChange={(v) => setPrefs({ hwdec: v })}
        />
        <ToggleRow
          title="Smooth colour banding"
          caption="Removes visible steps in dark scenes and skies, at a small cost in GPU power"
          checked={prefs.deband}
          disabled={hasMpv === false}
          onChange={(v) => setPrefs({ deband: v })}
        />
        <SettingRow id="autocrop" disabled={hasMpv === false} />
        <PickRow title="Buffer" caption="How far ahead to load. Larger rides out a patchy connection but uses more memory.">
          <Dropdown
            label="Buffer"
            value={prefs.buffer}
            onChange={(v) => setPrefs({ buffer: v })}
            options={[
              { value: "small", label: "Small (30 s)" },
              { value: "normal", label: "Normal (90 s)" },
              { value: "large", label: "Large (5 min)" },
            ]}
          />
        </PickRow>
      </Card>
      <Card title="Reset">
        <ResetRow {...expand("reset")} />
      </Card>
    </>
  );
}

function ResetRow(props: Expandable) {
  const qc = useQueryClient();
  const reset = useMutation({
    mutationFn: api.resetSettings,
    onSuccess: (saved) => {
      qc.setQueryData(keys.settings, saved);
      resetPrefs();
      for (const k of ["streams", "continue", "history"]) qc.invalidateQueries({ queryKey: [k] });
      props.onToggle();
    },
  });
  return (
    <ExpandRow icon={Reset} title="Reset all settings" caption="Put every option back to how it started" {...props}>
      <p className="settings-expand-text">
        Your library, history, profiles, add-ons, keyboard shortcuts, and API keys stay as they are.
      </p>
      <div className="settings-expand-actions">
        <Button variant="danger" disabled={reset.isPending} onClick={() => reset.mutate()}>
          <Reset size={15} /> Reset Settings
        </Button>
      </div>
      {reset.isError && <p className="settings-error">{String(reset.error)}</p>}
    </ExpandRow>
  );
}
