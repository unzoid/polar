import type { ReactNode } from "react";

export type EmptyStateProps = {
  /** The message: what's missing or what went wrong, and what to do about it. */
  children: ReactNode;
  /** A way out, shown as a link after the message ("Try again"). */
  action?: { label: string; onClick: () => void };
  /** Extra classes for a screen's spacing (`calendar-empty`), not for restyling. */
  className?: string;
};

/**
 * The note a screen or section shows instead of its content when there's nothing to show or it
 * couldn't load (docs/ui-components.md U20). Styling in styles/ui/empty-state.css.
 */
export function EmptyState({ children, action, className }: EmptyStateProps) {
  const cls = "empty-state t-body muted" + (className ? ` ${className}` : "");
  if (!action) return <p className={cls}>{children}</p>;
  return (
    <div className={cls}>
      {children}{" "}
      <button className="settings-link" onClick={action.onClick}>
        {action.label}
      </button>
    </div>
  );
}
