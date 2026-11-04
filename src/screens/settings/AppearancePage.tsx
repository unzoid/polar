import { Dropdown } from "../../components/Dropdown";
import { useSettings, useUpdateSettings } from "../../lib/queries";
import type { Settings as SettingsT } from "../../lib/types";
import { setPrefs, usePrefs } from "../../lib/prefs";
import { uiFontOf } from "../../lib/fonts";
import { isMac } from "../../lib/platform";
import { Card, NumberRow, PickRow } from "../../components/settings/rows";

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
        <PickRow title="Background">
          <Dropdown
            label="Background"
            value={data.theme === "black" ? "black" : "dark"}
            onChange={(v) => set({ theme: v })}
            options={[
              { value: "dark", label: "Dark" },
              { value: "black", label: "Black (OLED)" },
            ]}
          />
        </PickRow>
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
        <PickRow title="Card size" caption="Posters and thumbnails in rows and grids">
          <Dropdown
            label="Card size"
            value={data.cardSize ?? "medium"}
            onChange={(v) => set({ cardSize: v })}
            options={[
              { value: "small", label: "Small" },
              { value: "medium", label: "Medium" },
              { value: "large", label: "Large" },
            ]}
          />
        </PickRow>
      </Card>

      <Card title="Text and Motion">
        <PickRow title="Font">
          <Dropdown
            label="Font"
            value={uiFontOf(data.uiFont)}
            onChange={(v) => set({ uiFont: v })}
            options={[
              { value: "inter", label: "Inter" },
              { value: "system", label: "System" },
              { value: "opendyslexic", label: "OpenDyslexic" },
            ]}
          />
        </PickRow>
        <PickRow title="Reduce motion" caption="Fades instead of slides and zooms, and no rotating carousel">
          <Dropdown
            label="Reduce motion"
            value={data.reduceMotion ?? "system"}
            onChange={(v) => set({ reduceMotion: v })}
            options={[
              { value: "system", label: isMac ? "Match macOS" : "Match Windows" },
              { value: "on", label: "On" },
              { value: "off", label: "Off" },
            ]}
          />
        </PickRow>
      </Card>
    </>
  );
}
