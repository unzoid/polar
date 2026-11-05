import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { isDesktop } from "./device";

/**
 * Where new versions come from and how they're put in place. Desktop builds
 * update themselves from the signed `latest.json` on the newest GitHub release
 * (lib/updater.ts keeps the state); app stores update phone and TV builds, so
 * there `canUpdate` is false and only the version is read.
 */
export interface AppUpdates {
  /** False where the store installs updates (Android, iOS, tvOS): no checks, no buttons. */
  canUpdate: boolean;
  version(): Promise<string>;
  /** The newer build, or null when this one is current. */
  check(): Promise<FoundUpdate | null>;
  /** Start the installed build again (after `install`). */
  relaunch(): Promise<void>;
}

export interface FoundUpdate {
  version: string;
  notes: string;
  /** Fetch it; `progress` gets bytes so far and the total (0 when the server doesn't say). */
  download(progress: (got: number, total: number) => void): Promise<void>;
  /** Put the downloaded build in place. On Windows the installer closes the app itself. */
  install(): Promise<void>;
}

export const appUpdates: AppUpdates = {
  canUpdate: isDesktop,
  version: () => getVersion(),
  async check() {
    const found = await check();
    if (!found) return null;
    return {
      version: found.version,
      notes: found.body ?? "",
      async download(progress) {
        let total = 0;
        let got = 0;
        await found.download((e) => {
          if (e.event === "Started") total = e.data.contentLength ?? 0;
          else if (e.event === "Progress") progress((got += e.data.chunkLength), total);
        });
      },
      install: () => found.install(),
    };
  },
  relaunch: () => relaunch(),
};
