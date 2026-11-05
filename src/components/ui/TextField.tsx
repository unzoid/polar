import type { InputHTMLAttributes, Ref } from "react";

type Native = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "className" | "ref">;

export type TextFieldProps = Native & {
  /** `box` (default): the compact settings field. `block`: full width and 44px tall, the account screens' column. */
  look?: "box" | "block";
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
export function TextField({ look = "box", value, onChange, className, ...rest }: TextFieldProps) {
  let cls = look === "block" ? "text-field text-field-block" : "text-field";
  if (className) cls += ` ${className}`;
  return <input className={cls} value={value} onChange={(e) => onChange(e.target.value)} {...rest} />;
}
