import type { ReactNode } from "react";
import logo from "../../assets/polarity-white.png";
import { WindowControls } from "../../components/WindowControls";

/** Full-window frame for the account screens: brand, drag region, window buttons. */
export function AccountShell({ children, header, plain = false }: { children: ReactNode; header?: ReactNode; plain?: boolean }) {
  return (
    <div className="account-shell" data-plain={plain || undefined}>
      {!plain && <div className="account-glow" aria-hidden />}
      <header className="account-bar" data-tauri-drag-region>
        {/* Plain (sign-in): the mark sits over the form instead. */}
        <span className="account-brand" data-tauri-drag-region>
          {!plain && <img className="brand-logo" src={logo} alt="Polarity" draggable={false} />}
        </span>
        {header}
        <WindowControls />
      </header>
      <main className="account-main">{children}</main>
    </div>
  );
}
