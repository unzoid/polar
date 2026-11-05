import type { InputHTMLAttributes } from "react";

type Native = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role" | "className" | "checked" | "onChange">;

export type SwitchProps = Native & {
  checked: boolean;
  onChange: (checked: boolean) => void;
};

/**
 * An on/off switch (docs/ui-components.md U17): a native checkbox with `role="switch"`, so it
 * works with the keyboard and a label around it names it. Styling in styles/ui/switch.css.
 */
export function Switch({ checked, onChange, ...rest }: SwitchProps) {
  return <input type="checkbox" className="switch" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} {...rest} />;
}
