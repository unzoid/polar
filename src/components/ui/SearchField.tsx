import { useRef, type InputHTMLAttributes, type KeyboardEvent, type Ref } from "react";
import { Close, Search } from "../icons";

/**
 * - `box`: the Settings field (Shortcuts, Marketplace, Anime → Browse), a rounded box with an accent ring.
 * - `pill`: a quiet pill among other pills (AnimeDetail's episode search).
 * - `mini`: the small pill in a filter row's head (source filters).
 * - `plain`: structure only; a screen draws the box itself (the settings overlay's `.t3s-search`).
 */
export type SearchFieldLook = "box" | "pill" | "mini" | "plain";

const ICON_SIZE: Record<SearchFieldLook, number> = { box: 16, pill: 15, mini: 13, plain: 16 };

type Native = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange" | "className" | "aria-label" | "ref">;

export type SearchFieldProps = Native & {
  value: string;
  onChange: (value: string) => void;
  /** Names the field for screen readers; the placeholder isn't enough. */
  label: string;
  look?: SearchFieldLook;
  /** A key hint shown while the field is empty (the overlay's "/"). */
  kbd?: string;
  /** Extra classes on the outer `<label>`, for width and a screen's own box (`t3s-search`). */
  className?: string;
  ref?: Ref<HTMLInputElement>;
};

/**
 * A search input with its glyph and a clear button (docs/ui-components.md U14). Escape clears a field
 * with text in it and goes no further; on an empty field it reaches the sheet or overlay around it,
 * which closes. `onKeyDown` runs first; calling `preventDefault()` there skips the Escape handling.
 * Styling in styles/ui/search-field.css.
 */
export function SearchField({ value, onChange, label, look = "box", kbd, className, ref, onKeyDown, ...rest }: SearchFieldProps) {
  const input = useRef<HTMLInputElement | null>(null);
  const setRef = (el: HTMLInputElement | null) => {
    input.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) ref.current = el;
  };
  const keyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    onKeyDown?.(e);
    if (e.defaultPrevented || e.key !== "Escape" || !value) return;
    e.stopPropagation();
    onChange("");
  };
  const root = `search-field search-field-${look}` + (className ? ` ${className}` : "");
  return (
    <label className={root}>
      <Search size={ICON_SIZE[look]} />
      <input
        ref={setRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={keyDown}
        aria-label={label}
        spellCheck={false}
        autoComplete="off"
        {...rest}
      />
      {value ? (
        <button
          type="button"
          className="search-field-clear"
          aria-label="Clear search"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange("");
            input.current?.focus();
          }}
        >
          <Close size={14} />
        </button>
      ) : (
        kbd && <kbd className="search-field-kbd">{kbd}</kbd>
      )}
    </label>
  );
}
