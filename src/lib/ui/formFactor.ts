import { useSyncExternalStore } from "react";
import { formFactor, onFormFactor } from "../platform/formFactor";

/** The form factor and touch flag (lib/platform/formFactor.ts), re-rendering when either changes. */
export function useFormFactor() {
  return useSyncExternalStore(onFormFactor, formFactor);
}

/**
 * Mirrors both onto the root element as data-form and data-touch, so CSS lays out the shell (shell.css) and sizes
 * targets (tokens.css) from them, portalled UI included.
 */
export function mirrorFormFactor(root: HTMLElement) {
  const apply = () => {
    const { form, touch } = formFactor();
    root.dataset.form = form;
    root.dataset.touch = String(touch);
  };
  apply();
  return onFormFactor(apply);
}
