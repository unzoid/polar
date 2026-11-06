import { call, inShell } from "./bridge";
import { os } from "./device";

/**
 * iOS's own alerts, action sheets and share sheet (src-tauri/src/ios/dialogs.m, UIAlertController and
 * UIActivityViewController): they take the system's look, Liquid Glass on iOS 26, and VoiceOver and Larger Text
 * with it. Elsewhere the web app draws its own dialogs and these aren't called.
 */
export const nativeDialogsAvailable = os === "ios" && inShell;

export type DialogAction = { id: string; label: string; style: "default" | "cancel" | "destructive" };

/** Where on the page (CSS pixels) a sheet points from on an iPad. */
export type Anchor = { x: number; y: number; width: number; height: number };

export type NativeDialog = {
  /** An alert asks in the middle of the screen; a sheet offers actions from the bottom (an iPad: from `anchor`). */
  kind: "alert" | "sheet";
  title?: string;
  message?: string;
  actions: DialogAction[];
  anchor?: Anchor;
};

/** The id of the action picked, or null when the dialog went away without one. */
export function showNativeDialog(dialog: NativeDialog): Promise<string | null> {
  return call<string | null>("native_dialog", { dialog });
}

/** The share sheet, with `text` and, when given, `url`; on an iPad it points from `anchor`. */
export function shareNatively(share: { text: string; url?: string; anchor?: Anchor }): Promise<void> {
  return call("native_share", { share });
}

/** An element's place on the page, for `anchor`. */
export function anchorOf(el: Element | null | undefined): Anchor | undefined {
  if (!el) return undefined;
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, width: r.width, height: r.height };
}
