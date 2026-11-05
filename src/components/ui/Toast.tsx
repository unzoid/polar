import type { HTMLAttributes, ReactNode } from "react";

export type ToastProps = Omit<HTMLAttributes<HTMLDivElement>, "className" | "children" | "role"> & {
  /** A 24px glyph at the start; give the svg `className="toast-icon"`. */
  icon?: ReactNode;
  /** The text: a `<strong>` headline, then `<span>` lines under it. */
  children: ReactNode;
  /** Buttons at the end. A text button takes `className="toast-action"`; icon buttons fit as they are. */
  actions?: ReactNode;
  /** More than one line of text: a rounded box with room around it instead of a pill. */
  lines?: boolean;
  /** `tv`: up top, clear of the hints bar, at TV size. */
  variant?: "tv";
  /** Going away: plays the way out (toast.css data-leaving); the caller removes it afterwards. */
  leaving?: boolean;
  /** Extra classes for one toast's own touches (`update-toast`), not for restyling. */
  className?: string;
};

/**
 * A floating pill that tells the user something happened (docs/ui-components.md U21): a controller
 * came or went, an update is ready. Announced politely (`role="status"`). The caller decides when it
 * shows and for how long. Styling in styles/ui/toast.css.
 */
export function Toast({ icon, children, actions, lines, variant, leaving, className, ...rest }: ToastProps) {
  let cls = variant === "tv" ? "toast toast-tv" : "toast";
  if (lines) cls += " toast-lines";
  if (className) cls += ` ${className}`;
  return (
    <div className={cls} role="status" data-leaving={leaving || undefined} {...rest}>
      {icon}
      <span className="toast-text">{children}</span>
      {actions}
    </div>
  );
}
