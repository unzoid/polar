import { useSetting } from "../../lib/settings/useSetting";
import { choicesOf, shownNumber, storedNumber, type Value } from "../../lib/settings/schema";
import { Dropdown } from "../Dropdown";
import { NumberRow, PickRow, ToggleRow } from "./rows";

/**
 * A desktop row drawn from the settings schema (lib/settings/schema.ts): a switch, a dropdown
 * or a slider, with the schema's title, caption, choices and range. `caption` overrides the
 * schema's when it depends on the moment ("This screen is 4K…"); `onChanged` runs after a change
 * (a sound, clearing a list).
 */
export function SettingRow({
  id,
  caption,
  disabled,
  onChanged,
}: {
  id: string;
  caption?: string;
  disabled?: boolean;
  onChanged?: (v: Value) => void;
}) {
  const { def, value, set } = useSetting(id);
  if (value === undefined || !def.control) return null;
  const change = (v: Value) => {
    set(v);
    onChanged?.(v);
  };
  const shared = { setting: def.id, title: def.title, caption: caption ?? def.caption };
  const control = def.control;

  switch (control.kind) {
    case "toggle":
      return <ToggleRow {...shared} checked={!!value} disabled={disabled} onChange={change} />;
    case "number":
      return (
        <NumberRow
          {...shared}
          value={shownNumber(control, Number(value))}
          min={control.min}
          max={control.max}
          step={control.step}
          unit={control.unit}
          zero={control.zero}
          onChange={(n) => change(storedNumber(control, n))}
        />
      );
    case "choice": {
      // Dropdown values are strings: each choice goes by its index.
      const choices = choicesOf(control, value);
      return (
        <PickRow {...shared}>
          <Dropdown
            label={def.controlLabel ?? def.title}
            value={String(choices.findIndex((c) => c.value === value))}
            onChange={(i) => change(choices[Number(i)].value)}
            options={choices.map((c, i) => ({ value: String(i), label: c.label }))}
          />
        </PickRow>
      );
    }
  }
}
