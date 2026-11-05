import { appWindow as win, isDesktop, isMac } from "../lib/platform";

/** Minimise / maximise / close for the frameless window on Windows and Linux; macOS has its own traffic lights, phones and tablets no window. */
export function WindowControls() {
  if (isMac || !isDesktop) return null;
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
