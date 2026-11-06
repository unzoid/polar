import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";

import { App } from "./App";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { queryClient } from "./lib/net";
import { AccountProvider } from "./lib/account";
import { installKeepFieldInView, mirrorFormFactor } from "./lib/ui";
import { inShell, os } from "./lib/platform";

// Inter with weight + optical-size axes: large titles get the Display cut automatically.
import "@fontsource-variable/inter/opsz.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/ui/button.css";
import "./styles/ui/chip.css";
import "./styles/ui/switch.css";
import "./styles/ui/search-field.css";
import "./styles/ui/text-field.css";
import "./styles/ui/empty-state.css";
import "./styles/ui/skeleton.css";
import "./styles/ui/toast.css";
import "./styles/ui/menu.css";
import "./styles/ui/layer.css";
import "./styles/title/poster-grid.css";
import "./styles/title/playlist-checklist.css";
import "./styles/shell.css";
import "./styles/cards.css";
import "./styles/detail.css";
import "./styles/sheet.css";
import "./styles/player.css";
import "./styles/party.css";
import "./styles/screens.css";
import "./styles/account.css";
import "./styles/settings-overlay.css";
import "./styles/marketplace.css";
import "./styles/anime.css";
import "./styles/tv.css";
import "./styles/updates.css";
import { installGamepad } from "./tv/gamepad";

// Font rendering differs by OS; base.css tunes text weight for Windows.
// "mac" also makes room for the traffic lights (shell.css).
document.documentElement.dataset.os = os === "windows" ? "windows" : os === "macos" ? "mac" : "other";
// Chromium's web views (WebView2, Android's) skip drawing shelves out of view (cards.css, #134); WebKit's
// scrollIntoView doesn't reach into them, so it keeps drawing them. Only Chromium has userAgentData.
if ("userAgentData" in navigator) document.documentElement.dataset.engine = "chromium";
// Phone, tablet or desktop, and touch: the shell and target sizes follow (lib/platform/formFactor.ts).
mirrorFormFactor(document.documentElement);
// Phones and tablets: the on-screen keyboard never covers the field it types into.
installKeepFieldInView();

const root = createRoot(document.getElementById("root")!);

if (!inShell) {
  root.render(
    <div className="not-tauri">
      <p className="t-title2">Polarity runs inside its desktop shell.</p>
      <p className="muted t-body">
        Start it with <code>bun run app</code>.
      </p>
    </div>,
  );
} else {
  installGamepad();
  root.render(
    <StrictMode>
      {/* reducedMotion="user": springs become instant cross-fades when the OS asks for less motion. */}
      <MotionConfig reducedMotion="user">
        <ErrorBoundary where="app">
          <QueryClientProvider client={queryClient}>
            <AccountProvider>
              <App />
            </AccountProvider>
          </QueryClientProvider>
        </ErrorBoundary>
      </MotionConfig>
    </StrictMode>,
  );
}
