import { useFormFactor } from "../../lib/ui";
import { Dropdown } from "../Dropdown";
import { Segmented } from "../Segmented";

/** Up to this many seasons show as tabs; more become a dropdown. A phone has room for two. */
const MAX_TABS = 6;
const MAX_TABS_PHONE = 2;

/**
 * A title's seasons (docs/ui-components.md U7): large tabs, or a large dropdown for long-running shows, whose
 * tabs would run off the screen and hide most seasons. Used by show pages and anime franchises.
 */
export function SeasonPicker({ value, options, onChange }: { value: number; options: { id: number; label: string }[]; onChange: (id: number) => void }) {
  const { form } = useFormFactor();
  return options.length > (form === "phone" ? MAX_TABS_PHONE : MAX_TABS) ? (
    <Dropdown
      label="Season"
      size="large"
      value={String(value)}
      onChange={(v) => onChange(Number(v))}
      options={options.map((o) => ({ value: String(o.id), label: o.label }))}
    />
  ) : (
    <Segmented label="Season" variant="large" value={value} onChange={onChange} options={options} />
  );
}
