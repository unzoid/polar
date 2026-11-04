import { Reset } from "../../components/icons";
import { useEffect, useState } from "react";
import { Dropdown } from "../../components/Dropdown";
import { usePrefs } from "../../lib/settings";
import { useControllerDetected, useGamepadConnected, useLastPadPress } from "../../tv/gamepad";
import {
  NAV_ACTIONS,
  PAD_BUTTONS,
  PLAYER_ACTIONS,
  canBind,
  padBindingsCustomized,
  resetPadBindings,
  setPadBinding,
  usePadBindings,
  type Layout,
  type PadButton,
} from "../../tv/padBindings";
import { PadGlyph } from "../../tv/TvChrome";
import { ActionRow, Card, RowText } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";

/** Where each button sits, the same on every maker's controller (the glyph says what it's called). */
const PAD_BUTTON_NAMES: Record<PadButton, string> = {
  a: "Bottom button",
  b: "Right button",
  x: "Left button",
  y: "Top button",
  lb: "Left bumper",
  rb: "Right bumper",
  menu: "Menu / Start",
  view: "View / Select",
};

/** The button just pressed on a controller, for a moment, so you can find its row by pressing it. */
function usePressedButton() {
  const last = useLastPadPress();
  const [lit, setLit] = useState<string | null>(null);
  useEffect(() => {
    if (!last || performance.now() - last.at > 700) return;
    setLit(last.button);
    const t = window.setTimeout(() => setLit(null), 700);
    return () => window.clearTimeout(t);
  }, [last]);
  return lit;
}

function PadBindingRow({ layout, button, lit }: { layout: Layout; button: PadButton; lit: boolean }) {
  const bindings = usePadBindings();
  const actions: { id: string; label: string }[] = layout === "nav" ? NAV_ACTIONS : PLAYER_ACTIONS;
  // A button that's alone in doing Select or Back can only trade it for another button's job.
  const options = actions
    .filter((a) => canBind(bindings, layout, button, a.id as never))
    .map((a) => ({ value: a.id, label: a.label }));
  const name = PAD_BUTTON_NAMES[button];
  return (
    <div className="settings-row pad-binding-row" data-lit={lit || undefined}>
      <span className="pad-binding-button">
        <PadGlyph button={button} />
        <RowText title={name} />
      </span>
      <Dropdown
        label={`${name} ${layout === "nav" ? "while browsing" : "in the player"}`}
        value={bindings[layout][button] as string}
        options={options}
        onChange={(v) => setPadBinding(layout, button, v as never)}
      />
    </div>
  );
}

function PadBindingsCard({ layout, title, footer }: { layout: Layout; title: string; footer: string }) {
  const bindings = usePadBindings();
  const lit = usePressedButton();
  return (
    <Card title={title} footer={footer}>
      {PAD_BUTTONS.map((b) => (
        <PadBindingRow key={b} layout={layout} button={b} lit={lit === b} />
      ))}
      <ActionRow
        title="Standard layout"
        caption="Put every button back as it came"
        label="Reset"
        glyph={<Reset size={15} />}
        disabled={!padBindingsCustomized(bindings, layout)}
        onClick={() => resetPadBindings(layout)}
      />
    </Card>
  );
}

export function ControllerPage() {
  const prefs = usePrefs();
  const connected = useGamepadConnected();
  const detected = useControllerDetected();

  return (
    <>
      <Card title="Controller">
        <div className="settings-row">
          <RowText
            title={connected ? "Controller connected" : detected ? "Controller found" : "No controller connected"}
            caption={
              connected
                ? "Press a button to find its row below"
                : detected
                  ? "Press any button on it to start using it"
                  : "Plug one in or switch it on. Xbox, PlayStation and most others work"
            }
          />
        </div>
        <SettingRow id="controllerAlerts" />
        <SettingRow id="suggestTvMode" />
        <SettingRow id="padLabels" />
        <SettingRow id="padHints" />
      </Card>

      <Card title="D-pad & Stick">
        <SettingRow id="padRepeat" />
        <SettingRow id="padStick" />
        {prefs.padStick && (
          <SettingRow id="padStickSensitivity" />
        )}
        <SettingRow id="padPlayerVolume" />
      </Card>

      <PadBindingsCard
        layout="nav"
        title="Buttons while browsing"
        footer="Give a button a job another one has and the two swap. Select and Back always keep a button."
      />
      <PadBindingsCard
        layout="player"
        title="Buttons in the player"
        footer="Left and right skip by the seek step under Playback. In the menus over the video, your Select and Back buttons work as they do everywhere else."
      />
    </>
  );
}
