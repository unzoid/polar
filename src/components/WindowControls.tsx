import { getCurrentWindow } from "@tauri-apps/api/window";
import { isMac } from "../lib/platform";

const win = getCurrentWindow();

/** Minimise / maximise / close for Windows' frameless window; macOS has its own traffic lights. */
export function WindowControls() {
  if (isMac) return null;
  return (
    <div className="window-controls">
      <button aria-label="Minimize" onClick={() => win.minimize()}>
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" /></svg>
      </button>
      <button aria-label="Maximize" onClick={() => win.toggleMaximize()}>
        <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" /></svg>
      </button>
      <button aria-label="Close" className="close" onClick={() => win.close()}>
        <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" /></svg>
      </button>
    </div>
  );
}
