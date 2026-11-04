import { Dropdown } from "../../components/Dropdown";
import { ShortcutSettings } from "../../components/ShortcutSettings";
import { setPrefs, usePrefs } from "../../lib/prefs";
import { playSound, SOUND_PACKS } from "../../tv/sounds";
import { setTvMode } from "../../tv/tvMode";
import { Button } from "../../components/ui/Button";
import { Card, PickRow, RowText, ToggleRow } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";

export function ControlsPage() {
  const prefs = usePrefs();

  return (
    <>
      <Card title="TV Mode">
        <div className="settings-row">
          <RowText title="TV mode" caption="A fullscreen interface for the couch, made for a remote or controller." />
          <Button onClick={() => setTvMode(true)}>
            Open TV Mode
          </Button>
        </div>
        <ToggleRow
          title="TV mode button in the top bar"
          caption="Off hides it; TV mode stays one click away here"
          checked={prefs.showTvButton}
          onChange={(v) => setPrefs({ showTvButton: v })}
        />
        <SettingRow id="uiSounds" onChanged={(v) => v && playSound("select", { force: true })} />
        {prefs.uiSounds && (
          <PickRow title="Sound pack">
            <Dropdown
              label="Sound pack"
              value={prefs.uiSoundPack}
              onChange={(v) => {
                setPrefs({ uiSoundPack: v });
                playSound("select", { force: true });
              }}
              options={SOUND_PACKS}
            />
          </PickRow>
        )}
        {prefs.uiSounds && (
          <SettingRow id="uiSoundVolume" onChanged={() => playSound("select", { force: true })} />
        )}
      </Card>
      <ShortcutSettings />
    </>
  );
}
