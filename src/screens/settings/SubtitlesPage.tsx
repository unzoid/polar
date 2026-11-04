import { useQuery } from "@tanstack/react-query";
import { DEFAULT_SUBTITLE_STYLE, SubtitleSettings, subtitleCueVars } from "../../components/player/SubtitleSettings";
import { api } from "../../lib/api";
import { useSettings, useUpdateSettings } from "../../lib/queries";
import { Card } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";
import { keys } from "../../lib/queryKeys";

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
          <SettingRow id="subtitleMode" />
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
  const { data: hasMpv } = useQuery({ queryKey: keys.mpv, queryFn: api.mpvAvailable, staleTime: Infinity });
  return (
    <Card
      title="Sound"
      footer={
        hasMpv === false
          ? "These need mpv, which plays most files. Install mpv to use them."
          : "Saved on this device, so headphones and a home cinema can each have their own."
      }
    >
      <SettingRow id="dialogueBoost" disabled={hasMpv === false} />
      <SettingRow id="volumeLeveling" disabled={hasMpv === false} />
    </Card>
  );
}
