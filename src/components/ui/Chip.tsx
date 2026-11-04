import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode, Ref } from "react";
import { Check } from "../icons";

/**
 * The app's chips and badges (docs/ui-components.md U15). Styling in styles/ui/chip.css.
 *
 * - `filter`: a small pill to browse by (a genre, Anime's nav strip, search suggestions); light when pressed.
 * - `tag`: a compact filter tag (Source filters, Anime's active filters); accent when pressed.
 * - `choice`: one of a row of choices (source filter options, subtitle settings); light when pressed.
 * - `link`: a link out to another site, tinted by `--site` or `data-site`.
 * - `badge`: the outlined pill of a ranking, for a button that sits among them (the cast's Show button).
 */
export type ChipVariant = "filter" | "tag" | "choice" | "link" | "badge";

const CHIP_CLASS: Record<ChipVariant, string> = {
  filter: "genre-chip",
  tag: "srcf-tag",
  choice: "source-chip",
  link: "details-link pressable",
  badge: "anime-ranking",
};

/** The class list for a chip look, for elements that aren't a `<button>` of ours. */
export function chipClass(variant: ChipVariant = "filter", extra?: string): string {
  return extra ? `${CHIP_CLASS[variant]} ${extra}` : CHIP_CLASS[variant];
}

type Native = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "aria-pressed">;

export type ChipProps = Native & {
  variant?: ChipVariant;
  /** On/off state; becomes `aria-pressed`. Leave it out for a chip that only acts. */
  pressed?: boolean;
  /** Extra classes for layout or a screen's own hook (`anime-nav-main`), not for restyling. */
  className?: string;
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
};

/**
 * A pill button. A removable filter is `<Chip variant="tag" pressed aria-label="Remove …">` with a
 * close glyph as its last child.
 */
export function Chip({ variant = "filter", pressed, className, children, ...rest }: ChipProps) {
  return (
    <button className={chipClass(variant, className)} aria-pressed={pressed} {...rest}>
      {children}
    </button>
  );
}

/**
 * An on/off chip (Settings → tags, shelves). Turning it on, the accent fill
 * grows in under the label and a check slides open in front of it; turning it
 * off reverses both, a little quicker. CSS transitions throughout, so rapid
 * clicks retarget instead of restarting.
 */
export function ToggleChip({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <Chip variant="tag" className="toggle-chip" pressed={on} onClick={onToggle}>
      <span className="toggle-chip-check" aria-hidden>
        <span>
          <Check size={12} />
        </span>
      </span>
      {label}
    </Chip>
  );
}

/**
 * A static pill that only shows something: an AniList ranking (`rank`) or a tag with its score
 * (`tag`; `data-spoiler` turns it red).
 */
export function Badge({ variant, className, ...rest }: HTMLAttributes<HTMLSpanElement> & { variant: "rank" | "tag"; "data-spoiler"?: boolean }) {
  const base = variant === "rank" ? "anime-ranking" : "anime-tag";
  return <span className={className ? `${base} ${className}` : base} {...rest} />;
}
