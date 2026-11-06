import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings as Cog, Plus, Puzzle, Trash } from "../../components/icons";
import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { keys, useAddons } from "../../lib/net";
import { errorMessage } from "../../lib/errors";
import { Button } from "../../components/ui/Button";
import { Card, ExpandRow, FormRow, useExpanded } from "../../components/settings/rows";
import { showWhereStored, useSecretsNote } from "../../components/settings/secretsNote";
import { useKeyGate, useSecretsPlain } from "../../components/settings/KeyWarning";
import { linkHasKey } from "../../lib/account";

const hintsTried = new Set<string>();

export function AddonsPage() {
  const qc = useQueryClient();
  const { data: addons } = useAddons();
  const [url, setUrl] = useState("");
  const expand = useExpanded();
  const note = useSecretsNote();
  const gate = useKeyGate();
  const plain = useSecretsPlain();

  const refresh = () => {
    qc.invalidateQueries({ queryKey: keys.addons });
    qc.invalidateQueries({ queryKey: keys.streamsAll });
  };
  const install = useMutation({
    mutationFn: api.installAddon,
    onSuccess: () => {
      setUrl("");
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: api.removeAddon, onSuccess: refresh });

  // Manifests saved before behaviour hints were kept: refetch them once so
  // the Configure button can show.
  useEffect(() => {
    const stale = addons?.filter((a) => a.manifest.behaviorHints == null && !hintsTried.has(a.manifestUrl)) ?? [];
    if (!stale.length) return;
    for (const a of stale) hintsTried.add(a.manifestUrl);
    void Promise.allSettled(stale.map((a) => api.installAddon(a.manifestUrl))).then(refresh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addons]);

  return (
    <>
      {!!addons?.length && (
        <Card title="Installed" footer={note}>
          {addons.map((a) => (
            <ExpandRow
              key={a.manifest.id}
              icon={Puzzle}
              title={a.manifest.name}
              caption={linkHasKey(a.manifestUrl) ? "This link contains a key" : undefined}
              {...expand(a.manifest.id)}
            >
              {a.manifest.description && <p className="settings-expand-text">{a.manifest.description}</p>}
              <p className="settings-expand-text settings-url">{a.manifestUrl}</p>
              {linkHasKey(a.manifestUrl) && <KeyedLinkNote plain={plain} />}
              <div className="settings-expand-actions">
                {a.manifest.behaviorHints?.configurable && (
                  <Button
                    onClick={() => void api.openExternal(a.manifestUrl.replace(/\/manifest\.json$/, "/configure"))}
                    title="Opens the addon's settings page. Install the new link it gives you to apply them."
                  >
                    <Cog size={15} /> Configure
                  </Button>
                )}
                <Button variant="danger" onClick={() => remove.mutate(a.manifest.id)} disabled={remove.isPending}>
                  <Trash size={15} /> Remove
                </Button>
              </div>
            </ExpandRow>
          ))}
        </Card>
      )}
      {addons && !addons.length && (
        <Card title="Installed" footer={note}>
          <p className="settings-card-pad settings-expand-text">No add-ons yet. Titles have no sources to play until you install one.</p>
        </Card>
      )}
      <Card
        title="Install from URL"
        footer="Looking for something to add? Browse the Marketplace."
      >
        <FormRow
          placeholder="https://…/manifest.json"
          value={url}
          onChange={setUrl}
          onSubmit={(u) => gate.guard(linkHasKey(u) ? "link" : null, () => install.mutate(u))}
          submit="Install"
          glyph={<Plus size={16} />}
          pending={install.isPending}
          pendingLabel="Installing…"
          error={install.isError && errorMessage(install.error)}
        />
        {gate.warning}
      </Card>
    </>
  );
}

/** Under an installed add-on whose link holds a key (#195); the warning too while keys sync unencrypted. */
function KeyedLinkNote({ plain }: { plain: boolean }) {
  return (
    <p className="settings-expand-text settings-keyed" data-keyed-link>
      <strong>This link contains a key.</strong>{" "}
      {plain
        ? "It's stored on your account unencrypted: anyone with access to the account server could read it. Set a passphrase to encrypt it. "
        : "Keep it to yourself: anyone with the link can use what the key opens. "}
      <button type="button" className="settings-link" onClick={showWhereStored}>
        {plain ? "Set a passphrase" : "What's stored where"}
      </button>
    </p>
  );
}
