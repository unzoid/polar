import type { InputHTMLAttributes, Ref } from "react";

type Native = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "className" | "ref">;

export type TextFieldProps = Native & {
  value: string;
  onChange: (value: string) => void;
  /** Extra classes for layout, not for restyling. */
  className?: string;
  ref?: Ref<HTMLInputElement>;
};

/**
 * A one-line text input (docs/ui-components.md U14): Settings forms, API keys, a new playlist's name.
 * Name it with `aria-label` or a `<label>` around it when no visible label sits next to it.
 * Styling in styles/ui/text-field.css; the settings overlay restyles it in `.t3s`.
 */
export function TextField({ value, onChange, className, ...rest }: TextFieldProps) {
  return <input className={className ? `text-field ${className}` : "text-field"} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />;
}
