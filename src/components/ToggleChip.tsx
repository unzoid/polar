import { Check } from "./icons";

/**
 * An on/off chip (Settings → tags, shelves). Turning it on, the accent fill
 * grows in under the label and a check slides open in front of it; turning it
 * off reverses both, a little quicker. CSS transitions throughout, so rapid
 * clicks retarget instead of restarting. Styling: `.toggle-chip` in sheet.css.
 */
export function ToggleChip({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button className="srcf-tag toggle-chip" aria-pressed={on} onClick={onToggle}>
      <span className="toggle-chip-check" aria-hidden>
        <span>
          <Check size={12} />
        </span>
      </span>
      {label}
    </button>
  );
}
