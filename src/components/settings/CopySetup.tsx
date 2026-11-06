import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../../lib/api";
import { copySetup, SECRET_KEYS, setupSources, setupSourcesReady, useAccount } from "../../lib/account";
import { errorMessage } from "../../lib/errors";
import { useAddons, useSettings } from "../../lib/net";
import { usePrefs } from "../../lib/settings";
import { ActionRow, Card } from "./rows";

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * Settings → Account (#80): a profile that started on this device without anyone else's add-ons and
 * keys can copy a set from here: the guest's, or one of the account's other profiles'. Shown only while
 * it has none of its own (the app's own add-ons aside) and add-ons and keys aren't shared on this device.
 */
export function CopySetup() {
  const account = useAccount();
  const { shareAddonsAndKeys } = usePrefs();
  const { data: settings } = useSettings();
  const { data: addons } = useAddons();
  const { data: bundled } = useQuery({ queryKey: ["addons", "bundled"], queryFn: () => api.bundledAddons().catch(() => [] as string[]), staleTime: Infinity });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(0);
  const profile = account.profile;
  const others = account.profiles.map((p) => p.id);
  const { data: readable } = useQuery({
    queryKey: ["setup-sources", profile?.id, others],
    queryFn: () => setupSourcesReady(profile!.id, others),
    enabled: !!profile,
    staleTime: Infinity,
  });

  if (!profile || shareAddonsAndKeys || !settings || !addons || !bundled || !readable) return null;
  const own = settings as unknown as Record<string, unknown>;
  const empty = !SECRET_KEYS.some((k) => own[k]) && addons.every((a) => bundled.includes(a.manifestUrl));
  const sources = setupSources(profile.id, others);
  if (!empty || !sources.length) return null;
  const name = (id: string) => account.profiles.find((p) => p.id === id)?.name ?? "Guest";

  const copy = async (from: string) => {
    setBusy(from);
    setError(null);
    try {
      setFailed((await copySetup(from)).length);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card
      title="Add-ons and Keys"
      footer="This profile has no add-ons or API keys on this device. Copy a set from here to start with, or add your own: either way they're this profile's from then on."
    >
      {sources.map((s) => (
        <ActionRow
          key={s.id}
          setting="copySetup"
          title={s.id === "local" ? "From Guest on this device" : `From ${name(s.id)}`}
          caption={[s.addons && count(s.addons, "add-on"), s.keys && count(s.keys, "API key")].filter(Boolean).join(" · ")}
          label="Copy"
          disabled={!!busy}
          pending={busy === s.id}
          pendingLabel="Copying…"
          onClick={() => void copy(s.id)}
        />
      ))}
      {error && <p className="settings-error">{error}</p>}
      {failed > 0 && <p className="settings-error">{count(failed, "add-on")} didn't answer and weren't added.</p>}
    </Card>
  );
}
