import { Select } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";

interface Option<T extends string> {
  value: T;
  label: string;
}

/**
 * The app's dropdown: Base UI's Select (the same primitive T3 Code's select is
 * built on), so keyboard navigation, typeahead, focus handling and screen-reader
 * semantics come for free. Styling lives in base.css (`.select-*`).
 *
 *  - "default": settings rows, sort menus.
 *  - "large": the season picker, set in the same big type as the season tabs.
 */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "default",
}: {
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  label: string;
  size?: "default" | "large";
}) {
  return (
    <Select.Root
      value={value}
      onValueChange={(v) => v != null && onChange(v as T)}
      items={options}
    >
      <Select.Trigger className="select-trigger" data-size={size} aria-label={label}>
        <Select.Value className="select-value" />
        <Select.Icon className="select-icon">
          <ChevronDown size={size === "large" ? 20 : 15} strokeWidth={2.25} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner className="select-positioner" sideOffset={6} alignItemWithTrigger={false} align="start">
          <Select.Popup className="select-popup" data-size={size}>
            <Select.List className="select-list">
              {options.map((o) => (
                <Select.Item key={o.value} value={o.value} className="select-item">
                  <Select.ItemText className="select-item-text">{o.label}</Select.ItemText>
                  <Select.ItemIndicator className="select-item-check">
                    <Check size={15} strokeWidth={2.5} />
                  </Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
