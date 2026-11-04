import { useQuery } from "@tanstack/react-query";
import { Dropdown } from "../../components/Dropdown";
import { DEFAULT_SUBTITLE_STYLE, SubtitleSettings, subtitleCueVars } from "../../components/player/SubtitleSettings";
import { api } from "../../lib/api";
import { useSettings, useUpdateSettings } from "../../lib/queries";
import { setPrefs, usePrefs } from "../../lib/prefs";
import { Card, PickRow, ToggleRow } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";

export function SubtitlesPage() {
  const { data } = useSettings();
  const update = useUpdateSettings();
  if (!data) return null;
  const style = data.subtitleStyle ?? DEFAULT_SUBTITLE_STYLE;

  return (
    <>
      <Card title="Languages">
        <SettingRow id="audioLanguage" />
        <SettingRow id="subtitleLanguage" />
        {!!data.subtitleLanguage && (
          <PickRow
            title="Show subtitles"
            caption="Only for foreign audio: turn them on when the audio isn't already in your subtitle language"
          >
            <Dropdown
              label="Show subtitles"
              value={data.subtitleMode === "foreign" ? "foreign" : "always"}
              onChange={(v) => update.mutate({ subtitleMode: v })}
              options={[
                { value: "always", label: "Always" },
                { value: "foreign", label: "Only for foreign audio" },
              ]}
            />
          </PickRow>
        )}
      </Card>
      <SoundCard />
      <Card title="Subtitle Style">
        <div className="settings-sub-sample" style={subtitleCueVars(style)} aria-hidden>
          <span>This is how your subtitles will look.</span>
        </div>
        <div className="settings-card-pad">
          <SubtitleSettings
            style={style}
            onChange={(patch) => update.mutate({ subtitleStyle: { ...style, ...patch } })}
            canPosition
          />
        </div>
      </Card>
    </>
  );
}

/** mpv's audio options. They suit this device's speakers, so they stay on it. */
function SoundCard() {
  const prefs = usePrefs();
  const { data: hasMpv } = useQuery({ queryKey: ["mpv"], queryFn: api.mpvAvailable, staleTime: Infinity });
  return (
    <Card
      title="Sound"
      footer={
        hasMpv === false
          ? "These need mpv, which plays most files. Install mpv to use them."
          : "Saved on this device, so headphones and a home cinema can each have their own."
      }
    >
      <ToggleRow
        title="Boost dialogue"
        caption="Makes voices clearer on surround (5.1 and 7.1) audio by turning the centre channel up and the rest down"
        checked={prefs.dialogueBoost}
        disabled={hasMpv === false}
        onChange={(v) => setPrefs({ dialogueBoost: v })}
      />
      <ToggleRow
        title="Even out volume"
        caption="Night mode: quieter explosions, louder whispers"
        checked={prefs.volumeLeveling}
        disabled={hasMpv === false}
        onChange={(v) => setPrefs({ volumeLeveling: v })}
      />
    </Card>
  );
}
