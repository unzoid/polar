import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { Unlisten } from "./bridge";

/**
 * The app's window: buttons for a frameless desktop window, fullscreen for the
 * player and TV mode, focus and size for the player's controls, and interface
 * zoom. On phones and TVs the window is the whole screen: fullscreen hides the
 * system bars and minimise/maximise do nothing.
 */
export interface AppWindow {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  isMinimized(): Promise<boolean>;
  isFullscreen(): Promise<boolean>;
  setFullscreen(on: boolean): Promise<void>;
  /** Called with `false` when the window loses focus and `true` when it gets it back. */
  onFocusChanged(handler: (focused: boolean) => void): Promise<Unlisten>;
  onResized(handler: () => void): Promise<Unlisten>;
  /** Scales the whole interface (Settings → Interface size); 1 = as designed. */
  setZoom(scale: number): Promise<void>;
}

// Looked up on each use: the Tauri handle can't be made outside the shell, and importing this file must not fail there.
const win = () => getCurrentWindow();

export const appWindow: AppWindow = {
  minimize: () => win().minimize(),
  toggleMaximize: () => win().toggleMaximize(),
  close: () => win().close(),
  isMinimized: () => win().isMinimized(),
  isFullscreen: () => win().isFullscreen(),
  setFullscreen: (on) => win().setFullscreen(on),
  onFocusChanged: (handler) => win().onFocusChanged(({ payload }) => handler(payload)),
  onResized: (handler) => win().onResized(() => handler()),
  setZoom: (scale) => getCurrentWebview().setZoom(scale),
};
