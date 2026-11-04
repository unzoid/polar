import { useSettings, useUpdateSettings } from "../../lib/queries";
import { Card, ToggleRow } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";

export function PlaybackPage() {
  const { data } = useSettings();
  const update = useUpdateSettings();
  if (!data) return null;
  const recapsOn = data.autoSkipRecaps ?? data.autoSkip;

  return (
    <>
      <Card title="Autoplay">
        <SettingRow id="autoPickSource" />
        <SettingRow id="autoplayNext" />
        {data.autoplayNext && (
          <SettingRow id="autoplayCountdown" />
        )}
        {data.autoplayNext && (
          <SettingRow id="stillWatchingAfter" />
        )}
        <SettingRow id="nextUpTiming" />
      </Card>

      <Card title="Skipping" footer="Timings come from the IntroDB community database, or from the file's own chapters.">
        <SettingRow id="autoSkip" />
        {/* Unset follows Skip intros, so it isn't a plain schema row. */}
        <ToggleRow
          setting="autoSkipRecaps"
          title="Skip recaps"
          caption="Jump past the “previously on” part on its own"
          checked={recapsOn}
          onChange={(v) => update.mutate({ autoSkipRecaps: v })}
        />
        <SettingRow id="preferFileChapters" />
      </Card>

      <Card title="Resuming">
        <SettingRow id="resumePlayback" />
        {(data.resumePlayback ?? true) && <SettingRow id="resumeRewind" />}
        <SettingRow id="watchedThreshold" />
      </Card>

      <Card title="Player">
        <SettingRow id="startFullscreen" />
        <SettingRow id="pauseOnMinimize" />
        {/* Turning it on or off starts the next video at normal speed. */}
        <ToggleRow
          setting="rememberSpeed"
          title="Remember playback speed"
          caption="Keep the speed you last chose for the next video, instead of going back to normal"
          checked={!!data.rememberSpeed}
          onChange={(v) => update.mutate({ rememberSpeed: v, playbackSpeed: 1 })}
        />
        <SettingRow id="timeDisplay" />
        <SettingRow id="seekStep" />
        <SettingRow id="controlsHideSecs" />
        <SettingRow id="clickAction" />
        <SettingRow id="wheelAction" />
      </Card>
    </>
  );
}
