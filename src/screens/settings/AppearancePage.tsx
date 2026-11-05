import { useSettings, useUpdateSettings } from "../../lib/net";
import type { Settings as SettingsT } from "../../lib/types";
import { setPrefs, usePrefs } from "../../lib/settings";
import { Card, NumberRow, PickRow } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";

const ACCENTS = [
  { value: "#0A84FF", label: "Blue" },
  { value: "#5E5CE6", label: "Indigo" },
  { value: "#BF5AF2", label: "Purple" },
  { value: "#FF375F", label: "Pink" },
  { value: "#FF453A", label: "Red" },
  { value: "#FF9F0A", label: "Orange" },
  { value: "#FFD60A", label: "Yellow" },
  { value: "#30D158", label: "Green" },
  { value: "#64D2FF", label: "Teal" },
  { value: "#8E8E93", label: "Graphite" },
];


export function AppearancePage() {
  const { data } = useSettings();
  const update = useUpdateSettings();
  const prefs = usePrefs();
  if (!data) return null;
  const set = (patch: Partial<SettingsT>) => update.mutate(patch);
  const accent = (data.accentColor ?? "#0A84FF").toUpperCase();

  return (
    <>
      <Card title="Colour">
        <PickRow title="Accent colour" caption="Switches, selections and highlights">
          <div className="settings-swatches" role="radiogroup" aria-label="Accent colour">
            {ACCENTS.map((a) => (
              <button
                key={a.value}
                className="settings-swatch"
                role="radio"
                aria-checked={accent === a.value}
                aria-label={a.label}
                title={a.label}
                style={{ "--swatch": a.value } as React.CSSProperties}
                onClick={() => set({ accentColor: a.value })}
              />
            ))}
          </div>
        </PickRow>
        <SettingRow id="theme" />
      </Card>

      <Card title="Size">
        <NumberRow
          title="Interface size"
          caption="Zoom everything in or out. On this device."
          value={Math.round((prefs.uiScale > 0 ? prefs.uiScale : 1) * 100)}
          min={70}
          max={175}
          step={5}
          unit="%"
          onChange={(n) => setPrefs({ uiScale: n / 100 })}
        />
        <SettingRow id="cardSize" />
      </Card>

      <Card title="Text and Motion">
        <SettingRow id="uiFont" />
        <SettingRow id="reduceMotion" />
      </Card>
    </>
  );
}
