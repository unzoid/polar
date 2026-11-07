import { useEffect, useState } from "react";
import { Card } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";
import { askNotePermission, isDesktop, notePermission, os, type NotePermission } from "../../lib/platform";
import { usePrefs } from "../../lib/settings";
import type { Value } from "../../lib/settings/schema";

/** Where notes come from on this system, for the footer. */
const WHEN = isDesktop
  ? "Polarity notifies while it's running."
  : os === "ios"
    ? "Episodes with a listed air date are announced on time even with Polarity closed. Anything else is found when it next opens, or when iOS lets it check in the background, which isn't guaranteed."
    : "Episodes with a listed air date are announced on time even with Polarity closed. Anything else is found when it next opens.";

/** Settings → Notifications (#209): a switch per kind; phones ask the system the first time one is turned on. */
export function NotificationsPage() {
  const { notifyEpisodes, notifySeasons, notifyDownloads } = usePrefs();
  const [permission, setPermission] = useState<NotePermission>();
  const anyOn = notifyEpisodes || notifySeasons || notifyDownloads;

  useEffect(() => {
    let live = true;
    void notePermission().then((p) => live && setPermission(p));
    return () => {
      live = false;
    };
  }, []);

  // Switched on: ask, unless the system already answered.
  const turned = (v: Value) => {
    if (v !== true || permission === "granted") return;
    void askNotePermission().then(setPermission);
  };

  return (
    <>
      <Card title="Shows" footer={WHEN}>
        <SettingRow id="notifyEpisodes" onChanged={turned} />
        <SettingRow id="notifySeasons" onChanged={turned} />
        <SettingRow id="notifyScope" disabled={!notifyEpisodes && !notifySeasons} />
      </Card>
      <Card title="Downloads">
        <SettingRow id="notifyDownloads" onChanged={turned} />
      </Card>
      {anyOn && permission === "denied" && (
        <p className="settings-footer" role="status" data-testid="notify-denied">
          Notifications are turned off for Polarity in your system settings. Turn them on there to get these.
        </p>
      )}
      <p className="settings-footer">Checks run on this device, from the episode lists Polarity already loads. Nothing about your library is sent anywhere for them.</p>
    </>
  );
}
