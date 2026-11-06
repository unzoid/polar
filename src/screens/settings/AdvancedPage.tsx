import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Reset } from "../../components/icons";
import { api } from "../../lib/api";
import { keys } from "../../lib/net";
import { resetPrefs, settingDef, usePrefs } from "../../lib/settings";
import { lookaheadCaption } from "../../lib/playback";
import { Button } from "../../components/ui/Button";
import { errorMessage } from "../../lib/errors";
import { Card, ExpandRow, useExpanded, type Expandable } from "../../components/settings/rows";
import { SettingRow } from "../../components/settings/SettingRow";
import { os } from "../../lib/platform";
import { useAccount } from "../../lib/account";
import { StremioImport } from "../../components/settings/StremioImport";

export function AdvancedPage() {
  const expand = useExpanded();
  const { autocrop, autocropLookahead } = usePrefs();
  const { data: hasMpv } = useQuery({ queryKey: keys.mpv, queryFn: api.mpvAvailable, staleTime: Infinity });
  // What the lookahead does in the video playing now, kept current while this page is open.
  const { data: lookahead = null } = useQuery({
    queryKey: keys.mpvLookahead,
    queryFn: api.mpvLookahead,
    enabled: hasMpv === true && autocrop && autocropLookahead,
    refetchInterval: 3000,
  });
  const account = useAccount();
  return (
    <>
      <Card
        title="Video"
        footer={hasMpv === false ? "These need mpv." : "Saved on this device. Changes apply straight away, even mid-video."}
      >
        <SettingRow id="hwdec" disabled={hasMpv === false} />
        <SettingRow id="deband" disabled={hasMpv === false} />
        <SettingRow id="autocrop" disabled={hasMpv === false} />
        <SettingRow
          id="autocropLookahead"
          caption={lookaheadCaption(settingDef("autocropLookahead").caption ?? "", autocrop && autocropLookahead ? lookahead : null)}
          disabled={hasMpv === false || !autocrop}
        />
        {/* macOS and iOS read every frame anyway, in memory. */}
        {os !== "macos" && os !== "ios" && <SettingRow id="autocropEveryFrame" disabled={hasMpv === false || !autocrop} />}
        <SettingRow id="buffer" />
      </Card>
      {/* Signed in, it's under Account. */}
      {!account.profile && <StremioImport />}
      <Card title="Reset">
        <ResetRow {...expand("reset")} />
      </Card>
    </>
  );
}

function ResetRow(props: Expandable) {
  const qc = useQueryClient();
  const reset = useMutation({
    mutationFn: api.resetSettings,
    onSuccess: (saved) => {
      qc.setQueryData(keys.settings, saved);
      resetPrefs();
      for (const k of [keys.streamsAll, keys.continue, keys.history]) qc.invalidateQueries({ queryKey: k });
      props.onToggle();
    },
  });
  return (
    <ExpandRow icon={Reset} title="Reset all settings" caption="Put every option back to how it started" {...props}>
      <p className="settings-expand-text">
        Your library, history, profiles, add-ons, keyboard shortcuts, and API keys stay as they are.
      </p>
      <div className="settings-expand-actions">
        <Button variant="danger" disabled={reset.isPending} onClick={() => reset.mutate()}>
          <Reset size={15} /> Reset Settings
        </Button>
      </div>
      {reset.isError && <p className="settings-error">{errorMessage(reset.error)}</p>}
    </ExpandRow>
  );
}
