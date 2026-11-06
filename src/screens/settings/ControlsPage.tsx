import { ShortcutSettings } from "../../components/ShortcutSettings";
import { usePrefs } from "../../lib/settings";
import { playSound } from "../../tv/sounds";
import { setTvMode, tvModeAvailable } from "../../tv/tvMode";
import { ActionRow, Card } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";

export function ControlsPage() {
  const prefs = usePrefs();

  return (
    <>
      <Card title={tvModeAvailable ? "TV Mode" : "Sounds"}>
        {tvModeAvailable && (
          <>
            <ActionRow
              title="TV mode"
              caption="A fullscreen interface for the couch, made for a remote or controller."
              label="Open TV Mode"
              onClick={() => setTvMode(true)}
            />
            <SettingRow id="showTvButton" />
          </>
        )}
        <SettingRow id="uiSounds" onChanged={(v) => v && playSound("select", { force: true })} />
        {prefs.uiSounds && (
          <SettingRow id="uiSoundPack" onChanged={() => playSound("select", { force: true })} />
        )}
        {prefs.uiSounds && (
          <SettingRow id="uiSoundVolume" onChanged={() => playSound("select", { force: true })} />
        )}
      </Card>
      <ShortcutSettings />
    </>
  );
}
