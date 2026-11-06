import { useSyncExternalStore } from "react";
import { formFactor, onFormFactor } from "../platform/formFactor";

/** The form factor, touch and compact flags (lib/platform/formFactor.ts), re-rendering when one changes. */
export function useFormFactor() {
  return useSyncExternalStore(onFormFactor, formFactor);
}

/**
 * Mirrors them onto the root element as data-form, data-touch and data-compact, so CSS lays out the shell
 * (shell.css), sizes targets (tokens.css) and arranges the player (player.css) from them, portalled UI included.
 */
export function mirrorFormFactor(root: HTMLElement) {
  const apply = () => {
    const { form, touch, compact } = formFactor();
    root.dataset.form = form;
    root.dataset.touch = String(touch);
    root.dataset.compact = String(compact);
  };
  apply();
  return onFormFactor(apply);
}
