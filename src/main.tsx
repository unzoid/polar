import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";

import { App } from "./App";
import { queryClient } from "./lib/queries";
import { RouterProvider } from "./lib/router";
import { isTauri } from "./lib/api";

// Inter with weight + optical-size axes: large titles get the Display cut automatically.
import "@fontsource-variable/inter/opsz.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/cards.css";
import "./styles/detail.css";
import "./styles/sheet.css";
import "./styles/player.css";
import "./styles/screens.css";

const root = createRoot(document.getElementById("root")!);

if (!isTauri) {
  root.render(
    <div className="not-tauri">
      <p className="t-title2">Rustio runs inside its desktop shell.</p>
      <p className="muted t-body">
        Start it with <code>bun run app</code>.
      </p>
    </div>,
  );
} else {
  root.render(
    <StrictMode>
      {/* reducedMotion="user": springs become instant cross-fades when the OS asks for less motion. */}
      <MotionConfig reducedMotion="user">
        <QueryClientProvider client={queryClient}>
          <RouterProvider>
            <App />
          </RouterProvider>
        </QueryClientProvider>
      </MotionConfig>
    </StrictMode>,
  );
}
