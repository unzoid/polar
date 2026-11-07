import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";

/** The commit this build is made from, shown in Settings → About. "unknown" when git isn't available. */
function gitCommit() {
  try {
    return execSync("git rev-parse --short=7 HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "unknown";
  }
}

// Tauri expects a fixed dev port and must see Rust compile errors in the terminal.
export default defineConfig({
  plugins: [react()],
  define: { __GIT_COMMIT__: JSON.stringify(gitCommit()) },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ["**/src-tauri/**", "**/crates/**", "**/target/**"] },
  },
  build: {
    target: "es2022",
  },
});
