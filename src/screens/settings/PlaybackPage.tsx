import { useQueryClient } from "@tanstack/react-query";
import { Dropdown } from "../../components/Dropdown";
import { keys, useSettings, useUpdateSettings } from "../../lib/queries";
import type { Settings as SettingsT } from "../../lib/types";
import { setPrefs, usePrefs } from "../../lib/prefs";
import { Card, NumberRow, PickRow, ToggleRow } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";

export function PlaybackPage() {
  const qc = useQueryClient();
  const { data } = useSettings();
  const update = useUpdateSettings();
  const prefs = usePrefs();
  if (!data) return null;
  const set = (patch: Partial<SettingsT>) => update.mutate(patch);
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
        <PickRow title="Show Up Next" caption="When the next-episode card appears near the end of an episode">
          <Dropdown
            label="Show Up Next"
            value={data.nextUpTiming === "end" ? "end" : "credits"}
            onChange={(v) => set({ nextUpTiming: v })}
            options={[
              { value: "credits", label: "When the credits start" },
              { value: "end", label: "At the very end" },
            ]}
          />
        </PickRow>
      </Card>

      <Card title="Skipping" footer="Timings come from the IntroDB community database, or from the file's own chapters.">
        <SettingRow id="autoSkip" />
        <ToggleRow
          title="Skip recaps"
          caption="Jump past the “previously on” part on its own"
          checked={recapsOn}
          onChange={(v) => set({ autoSkipRecaps: v })}
        />
        <ToggleRow
          title="Use the file's own chapters for intros"
          caption="If the video has chapters named Intro, Recap or Credits, use those. Otherwise the online intro database fills in."
          checked={prefs.preferFileChapters}
          onChange={(v) => setPrefs({ preferFileChapters: v })}
        />
      </Card>

      <Card title="Resuming">
        <SettingRow id="resumePlayback" />
        {(data.resumePlayback ?? true) && (
          <NumberRow
            title="Back up when resuming"
            caption="Start a little before where you stopped, to pick up the thread"
            value={data.resumeRewind ?? 0}
            min={0}
            max={60}
            unit="sec"
            zero="Don't"
            onChange={(n) => set({ resumeRewind: n })}
          />
        )}
        <NumberRow
          title="Count as watched at"
          caption="How far into a video it moves out of Continue Watching and gets a tick"
          value={data.watchedThreshold ?? 92}
          min={50}
          max={100}
          unit="%"
          onChange={(n) =>
            update.mutate(
              { watchedThreshold: n },
              {
                onSuccess: () => {
                  qc.invalidateQueries({ queryKey: keys.continue });
                  qc.invalidateQueries({ queryKey: keys.history });
                },
              },
            )
          }
        />
      </Card>

      <Card title="Player">
        <ToggleRow
          title="Start in fullscreen"
          checked={!!data.startFullscreen}
          onChange={(v) => set({ startFullscreen: v })}
        />
        <ToggleRow
          title="Pause when minimized"
          caption="On this device"
          checked={prefs.pauseOnMinimize}
          onChange={(v) => setPrefs({ pauseOnMinimize: v })}
        />
        <ToggleRow
          title="Remember playback speed"
          caption="Keep the speed you last chose for the next video, instead of going back to normal"
          checked={!!data.rememberSpeed}
          onChange={(v) => set({ rememberSpeed: v, playbackSpeed: 1 })}
        />
        <PickRow title="Clock" caption="What the time next to the timeline shows. Clicking it there switches too.">
          <Dropdown
            label="Clock"
            value={data.timeDisplay ?? "remaining"}
            onChange={(v) => set({ timeDisplay: v })}
            options={[
              { value: "remaining", label: "Time left" },
              { value: "elapsed", label: "Elapsed / total" },
              { value: "endsAt", label: "Ends at" },
            ]}
          />
        </PickRow>
        <SettingRow id="seekStep" />
        <NumberRow
          title="Hide controls after"
          caption="Without moving the mouse"
          value={data.controlsHideSecs ?? 2}
          min={1}
          max={15}
          unit="sec"
          onChange={(n) => set({ controlsHideSecs: n })}
        />
        <PickRow title="Clicking the video">
          <Dropdown
            label="Clicking the video"
            value={data.clickAction === "controls" ? "controls" : "toggle"}
            onChange={(v) => set({ clickAction: v })}
            options={[
              { value: "toggle", label: "Plays or pauses" },
              { value: "controls", label: "Shows the controls" },
            ]}
          />
        </PickRow>
        <PickRow title="Scrolling over the video">
          <Dropdown
            label="Scrolling over the video"
            value={data.wheelAction ?? "volume"}
            onChange={(v) => set({ wheelAction: v })}
            options={[
              { value: "volume", label: "Changes volume" },
              { value: "seek", label: "Skips back and forward" },
              { value: "none", label: "Does nothing" },
            ]}
          />
        </PickRow>
      </Card>
    </>
  );
}
