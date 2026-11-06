import { Select } from "@base-ui/react/select";
import { Check, ChevronDown } from "./icons";
import { anchorOf, nativeDialogsAvailable, showNativeDialog } from "../lib/platform";
import { warnFailed } from "../lib/errors";

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
 *
 * On iOS the trigger opens the system's own menu instead, the current choice ticked.
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
  const chevron = <ChevronDown size={size === "large" ? 20 : 15} strokeWidth={2.25} />;
  if (nativeDialogsAvailable)
    return (
      <button
        type="button"
        className="select-trigger"
        data-size={size}
        aria-label={label}
        aria-haspopup="menu"
        onClick={(e) =>
          void showNativeDialog({
            kind: "menu",
            title: label,
            anchor: anchorOf(e.currentTarget),
            actions: options.map((o) => ({ id: o.value, label: o.label, style: "default", checked: o.value === value })),
          })
            .then((picked) => {
              const o = options.find((o) => o.value === picked);
              if (o && o.value !== value) onChange(o.value);
            })
            .catch(warnFailed("menu"))
        }
      >
        <span className="select-value">{options.find((o) => o.value === value)?.label}</span>
        <span className="select-icon">{chevron}</span>
      </button>
    );
  return (
    <Select.Root
      value={value}
      onValueChange={(v) => v != null && onChange(v as T)}
      items={options}
    >
      <Select.Trigger className="select-trigger" data-size={size} aria-label={label}>
        <Select.Value className="select-value" />
        <Select.Icon className="select-icon">{chevron}</Select.Icon>
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
