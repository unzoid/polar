import type { ReactNode } from "react";
import { WindowControls } from "../../components/WindowControls";

/** Full-window frame for the account screens: brand, drag region, window buttons. */
export function AccountShell({ children, header }: { children: ReactNode; header?: ReactNode }) {
  return (
    <div className="account-shell">
      <div className="account-glow" aria-hidden />
      <header className="account-bar" data-tauri-drag-region>
        <span className="account-brand" data-tauri-drag-region>
          <img src="/app-icon.svg" alt="" width={28} height={28} />
          <span>Rustio</span>
        </span>
        {header}
        <WindowControls />
      </header>
      <main className="account-main">{children}</main>
    </div>
  );
}
