import { type ReactNode, useLayoutEffect, useRef } from "react";

interface Option<T extends string | number> {
  id: T;
  label: string;
  /** Shown instead of the label, which becomes the accessible name and tooltip. */
  icon?: ReactNode;
}

/**
 * Segmented control. The selected state is a second, fully "active" copy of
 * the labels clipped to the selected segment; switching animates `clip-path`
 * (composite-only) so the pill and its text colour move as one — no
 * width/left layout animation, no colour cross-fade mismatch.
 *
 * Pointer changes glide; arrow-key changes are instant (keyboard actions
 * repeat too often to animate).
 */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  variant = "default",
}: {
  options: Option<T>[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  variant?: "default" | "large";
}) {
  const list = useRef<HTMLDivElement>(null);
  const active = useRef<HTMLDivElement>(null);
  const instant = useRef(true); // first placement never animates
  const placed = useRef(value);

  const optionsKey = options.map((o) => `${o.id}:${o.label}`).join("|");
  useLayoutEffect(() => {
    placed.current = value;
    // Hidden (a collapsed section, a closed sheet) measures nothing: placed when shown, below, without a glide.
    if (place(list.current, active.current, value, instant.current)) instant.current = false;
  }, [value, optionsKey]);

  // Shown after starting hidden, or resized (fonts loading, the window): placed again where it now belongs.
  useLayoutEffect(() => {
    const root = list.current;
    if (!root) return;
    const ro = new ResizeObserver(() => {
      if (place(root, active.current, placed.current, true)) instant.current = false;
    });
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  const select = (id: T, viaKeyboard = false) => {
    if (id === value) return;
    instant.current = viaKeyboard;
    onChange(id);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const i = options.findIndex((o) => o.id === value);
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const o = options[(i + step + options.length) % options.length];
    select(o.id, true);
    list.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(String(o.id))}"]`)?.focus();
  };

  return (
    <div className="segmented" data-variant={variant} role="radiogroup" aria-label={label} ref={list} onKeyDown={onKeyDown}>
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          data-id={o.id}
          aria-checked={o.id === value}
          tabIndex={o.id === value ? 0 : -1}
          className="segmented-item t-callout"
          onPointerDown={() => select(o.id)} // respond on press
          onClick={(e) => select(o.id, e.detail === 0)} // detail 0 = keyboard activation
          aria-label={o.icon ? o.label : undefined}
          title={o.icon ? o.label : undefined}
        >
          {o.icon ?? o.label}
        </button>
      ))}
      <div className="segmented-active" ref={active} aria-hidden>
        {options.map((o) => (
          <span key={o.id} className="segmented-item t-callout">
            {o.icon ?? o.label}
          </span>
        ))}
      </div>
    </div>
  );
}

/** Clips the active copy to `value`'s segment; false when there's nothing to measure (hidden). */
function place(root: HTMLElement | null, overlay: HTMLElement | null, value: string | number, instant: boolean): boolean {
  const el = root?.querySelector<HTMLElement>(`[data-id="${CSS.escape(String(value))}"]`);
  if (!root || !overlay || !el || !el.offsetWidth) return false;
  // Offsets relative to the overlay, which is inset by the track padding.
  const left = el.offsetLeft - overlay.offsetLeft;
  const right = overlay.clientWidth - left - el.offsetWidth;
  overlay.dataset.instant = String(instant);
  overlay.style.clipPath = `inset(0 ${right}px 0 ${left}px round 999px)`;
  return true;
}
