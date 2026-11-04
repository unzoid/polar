import { useState, type ReactNode } from "react";
import { ChevronRight, type Icon as IconT } from "../icons";
import { SliderField } from "../SliderField";
import { Button, type ButtonVariant } from "../ui/Button";
import { Switch } from "../ui/Switch";
import { TextField, type TextFieldProps } from "../ui/TextField";

/**
 * The settings building blocks (docs/ui-components.md §4, U26): a titled card of rows, and the
 * kinds of row in it. Styling in styles/screens.css (`.settings-*`) and the overlay's `.t3s` scope.
 */

/** A group of rows under an optional heading, with an optional note below. */
export function Card({ title, footer, children }: { title?: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section className="settings-group">
      {title && <h2 className="settings-group-title">{title}</h2>}
      <div className="settings-card">{children}</div>
      {footer && <p className="settings-footer">{footer}</p>}
    </section>
  );
}

/** A row's title and the caption under it. */
export function RowText({ title, caption }: { title: string; caption?: ReactNode }) {
  return (
    <span className="settings-row-text">
      <span className="settings-row-title">{title}</span>
      {caption && <span className="settings-row-caption">{caption}</span>}
    </span>
  );
}

/** An on/off setting; the whole row is its label. */
export function ToggleRow({
  setting,
  title,
  caption,
  checked,
  onChange,
  disabled,
}: {
  /** The schema id (lib/settings/schema.ts), so search can find the row. */
  setting?: string;
  title: string;
  caption?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="settings-row" data-setting={setting}>
      <RowText title={title} caption={caption} />
      <Switch checked={checked} disabled={disabled} onChange={onChange} />
    </label>
  );
}

/** A row with its control (a dropdown, chips, a button) on the right. */
export function PickRow({ setting, title, caption, children }: { setting?: string; title: string; caption?: string; children: ReactNode }) {
  return (
    <div className="settings-row" data-setting={setting}>
      <RowText title={title} caption={caption} />
      {children}
    </div>
  );
}

/**
 * A row with one button that does something now ("Sign Out", "Clear"). While `pending`
 * the button is disabled and reads `pendingLabel` (default: `label`).
 */
export function ActionRow({
  setting,
  title,
  caption,
  label,
  glyph,
  variant,
  onClick,
  disabled,
  pending,
  pendingLabel,
}: {
  setting?: string;
  title: string;
  caption?: ReactNode;
  label: ReactNode;
  /** A small icon before the label, sized by the caller (15px in settings). */
  glyph?: ReactNode;
  variant?: ButtonVariant;
  onClick: () => void;
  disabled?: boolean;
  pending?: boolean;
  pendingLabel?: ReactNode;
}) {
  return (
    <div className="settings-row" data-setting={setting}>
      <RowText title={title} caption={caption} />
      <Button variant={variant} disabled={disabled || pending} onClick={onClick}>
        {glyph}
        {pending ? (pendingLabel ?? label) : label}
      </Button>
    </div>
  );
}

/**
 * One text field and its submit button. The button is enabled when the tidied value
 * (`tidy`, default trim) differs from `saved`, or, with no `saved`, when it isn't empty;
 * `onSubmit` gets the tidied value. `look="expand"` lays it out inside an `ExpandRow`.
 * Other props go to the field (`placeholder`, `aria-label`, `type`…).
 */
export function FormRow({
  setting,
  value,
  onChange,
  onSubmit,
  saved,
  tidy = (v) => v.trim(),
  submit = "Save",
  glyph,
  pending,
  pendingLabel,
  error,
  look = "row",
  spellCheck = false,
  ...field
}: Omit<TextFieldProps, "onSubmit" | "look"> & {
  setting?: string;
  onSubmit: (value: string) => void;
  saved?: string;
  tidy?: (value: string) => string;
  submit?: ReactNode;
  glyph?: ReactNode;
  pending?: boolean;
  pendingLabel?: ReactNode;
  /** Shown under the row. */
  error?: ReactNode;
  look?: "row" | "expand";
}) {
  const next = tidy(value);
  const ready = saved === undefined ? next !== "" : next !== saved;
  return (
    <>
      <form
        className={look === "row" ? "settings-row" : "settings-expand-form"}
        data-setting={setting}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !pending) onSubmit(next);
        }}
      >
        <TextField value={value} onChange={onChange} spellCheck={spellCheck} {...field} />
        <Button variant="primary" disabled={!ready || pending}>
          {glyph}
          {pending ? (pendingLabel ?? submit) : submit}
        </Button>
      </form>
      {error && <p className="settings-error settings-card-pad">{error}</p>}
    </>
  );
}

/**
 * A number setting as a slider with the exact value in a box beside it, which
 * you can type into. `zero` names what 0 means ("Never", "Any size").
 */
export function NumberRow({
  setting,
  title,
  caption,
  value,
  min,
  max,
  step,
  unit,
  zero,
  onChange,
}: {
  setting?: string;
  title: string;
  caption?: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  zero?: string;
  onChange: (n: number) => void;
}) {
  return (
    <PickRow setting={setting} title={title} caption={caption}>
      <SliderField label={title} value={value} min={min} max={max} step={step} unit={unit} zero={zero} onChange={onChange} />
    </PickRow>
  );
}

/** What `useExpanded` hands each row. */
export type Expandable = { open: boolean; onToggle: () => void };

/** A row that opens in place to show its controls. */
export function ExpandRow({
  icon: Icon,
  title,
  caption,
  value,
  open,
  onToggle,
  children,
}: Expandable & {
  icon?: IconT;
  title: string;
  caption?: ReactNode;
  /** Short current state on the right ("On", a server address…). */
  value?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="settings-expand" data-open={open}>
      <button className="settings-row settings-row-button" aria-expanded={open} onClick={onToggle}>
        {Icon && <Icon className="settings-row-icon" size={20} strokeWidth={1.9} />}
        <RowText title={title} caption={caption} />
        {value != null && <span className="settings-row-value">{value}</span>}
        <ChevronRight className="settings-chevron" size={18} strokeWidth={2.25} />
      </button>
      {open && <div className="settings-expand-body">{children}</div>}
    </div>
  );
}

/** A row that leads somewhere else. */
export function LinkRow({ icon: Icon, title, caption, onClick }: { icon: IconT; title: string; caption?: string; onClick: () => void }) {
  return (
    <button className="settings-row settings-row-button" onClick={onClick}>
      <Icon className="settings-row-icon" size={20} strokeWidth={1.9} />
      <RowText title={title} caption={caption} />
      <ChevronRight className="settings-chevron" size={18} strokeWidth={2.25} />
    </button>
  );
}

/** One open row per card; clicking it again closes it. */
export function useExpanded() {
  const [open, setOpen] = useState<string | null>(null);
  return (id: string): Expandable => ({ open: open === id, onToggle: () => setOpen((o) => (o === id ? null : id)) });
}
