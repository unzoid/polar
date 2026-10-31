import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

interface Option<T extends string> {
  value: T;
  label: string;
}

/**
 * Listbox-style dropdown (Catalyst-like): a pill trigger, a floating menu with
 * a check on the current choice.
 *
 * - Opens on pointer-down, scales in from the trigger (origin-aware, 150ms
 *   strong ease-out); closes instantly — it's the system getting out of the way.
 * - Keyboard: Enter/Space/↓ opens, ↑↓ move, Home/End jump, Enter selects,
 *   Esc/Tab close. Opened from the keyboard → no animation.
 * - Closes on outside press; Esc closes only the menu, not what it sits in.
 */
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  align = "end",
}: {
  value: T;
  options: Option<T>[];
  onChange: (v: T) => void;
  label: string;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [instant, setInstant] = useState(false);
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const current = options.find((o) => o.value === value) ?? options[0];

  const show = (viaKeyboard: boolean) => {
    setInstant(viaKeyboard);
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const choose = (v: T) => {
    onChange(v);
    setOpen(false);
    root.current?.querySelector<HTMLButtonElement>(".dropdown-trigger")?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        e.stopPropagation();
        show(true);
      }
      return;
    }
    const move = (i: number) => setActive((i + options.length) % options.length);
    switch (e.key) {
      case "ArrowDown":
        move(active + 1);
        break;
      case "ArrowUp":
        move(active - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(options.length - 1);
        break;
      case "Enter":
      case " ":
        choose(options[active].value);
        break;
      case "Escape":
      case "Tab":
        setOpen(false);
        if (e.key === "Tab") return;
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div className="dropdown" ref={root} data-align={align} onKeyDown={onKeyDown}>
      <button
        type="button"
        className="dropdown-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${label}: ${current.label}`}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.preventDefault(); // keep focus on the trigger
          if (open) setOpen(false);
          else show(false);
        }}
      >
        <span>{current.label}</span>
        <ChevronDown size={15} strokeWidth={2.4} className="dropdown-chevron" />
      </button>
      {open && (
        <div className="dropdown-menu" id={id} role="listbox" aria-label={label} data-instant={instant}>
          {options.map((o, i) => (
            <div
              key={o.value}
              role="option"
              aria-selected={o.value === value}
              data-active={i === active}
              className="dropdown-item"
              onPointerEnter={() => setActive(i)}
              onClick={() => choose(o.value)}
            >
              <Check size={15} strokeWidth={2.6} className="dropdown-check" />
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
