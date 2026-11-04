import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";
import { BusyLabel } from "../BusyLabel";

/**
 * The app's buttons (docs/ui-components.md U12, U13). Styling in styles/ui/button.css.
 *
 * - `primary`: the light pill ("▶ Resume S2, E3"), one per screen.
 * - `glass`: secondary, a frosted pill over artwork.
 * - `plain`: the base pill; the settings overlay restyles it by scope (`.t3s .btn`).
 * - `danger`: red text; styled inside settings and at `size="sm"` (a red ring).
 * - `accent`: filled with the user's accent, for the step that commits a form (account screens).
 * - `outline`: a hairline ring, for side actions next to a primary (profile screens).
 */
export type ButtonVariant = "primary" | "glass" | "plain" | "danger" | "accent" | "outline";

/**
 * - `md` (default): the 46px pill.
 * - `sm`: 44px, at least 7rem wide (the profile screens' actions).
 * - `block`: full width, 44px, a soft fill unless `accent` (the account screens' single column).
 */
export type ButtonSize = "md" | "sm" | "block";

/**
 * The class list for a button look, for elements that aren't a `<button>` of ours
 * (a Base UI `Popover.Trigger`, `Menu.Trigger`, or a component that takes `className`).
 */
export function buttonClass(variant: ButtonVariant = "plain", icon = false, extra?: string, size: ButtonSize = "md"): string {
  let c = "btn";
  if (variant !== "plain") c += ` btn-${variant}`;
  if (size !== "md") c += ` btn-${size}`;
  if (icon) c += " btn-icon";
  return extra ? `${c} ${extra}` : c;
}

type Native = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">;

export type ButtonProps = Native & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Swaps the label for a spinner while true (after a short delay, so quick work doesn't flash it). */
  busy?: boolean;
  /** Extra classes for layout or a screen's own hook (`detail-play`), not for restyling. */
  className?: string;
  ref?: Ref<HTMLButtonElement>;
  children?: ReactNode;
};

/** A text button, with an optional leading glyph as its first child. */
export function Button({ variant = "plain", size, busy, className, children, ...rest }: ButtonProps) {
  return (
    <button className={buttonClass(variant, false, className, size)} aria-busy={busy || undefined} {...rest}>
      {busy === undefined ? children : <BusyLabel busy={busy}>{children}</BusyLabel>}
    </button>
  );
}

/**
 * Over the playing video (styles/player.css): `player` the glyphs in the player's top bar and the options
 * close, `transport` the large bare seek and play glyphs in the middle. Both press like `.pressable`.
 */
export type PlayerIconVariant = "player" | "transport";

const PLAYER_ICON: Record<PlayerIconVariant, string> = { player: "player-icon pressable", transport: "player-transport pressable" };

export type IconButtonProps = Omit<ButtonProps, "busy" | "aria-label" | "variant" | "size"> & {
  variant?: ButtonVariant | PlayerIconVariant;
  /** What the button does; becomes its accessible name. Required: an icon has no text. */
  label: string;
};

/**
 * A round button holding one glyph. Bare at rest with a faint circle on hover;
 * `variant="glass"` only matters where a screen styles `.btn-glass.btn-icon`.
 */
export function IconButton({ variant = "plain", label, className, children, ...rest }: IconButtonProps) {
  const cls =
    variant === "player" || variant === "transport" ? PLAYER_ICON[variant] + (className ? ` ${className}` : "") : buttonClass(variant, true, className);
  return (
    <button className={cls} aria-label={label} {...rest}>
      {children}
    </button>
  );
}
