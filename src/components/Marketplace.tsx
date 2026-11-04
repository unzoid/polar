import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../lib/api";
import { MARKET_CATEGORIES, MARKETPLACE_REPO, searchMarketplace, useMarketplace, type MarketCategory } from "../lib/marketplace";
import { keys, useAddons } from "../lib/queries";
import { openSettings } from "../lib/settingsOverlay";
import { Captions, Check, Info, Play, type Icon } from "./icons";
import { Button } from "./ui/Button";
import { SearchField } from "./ui/SearchField";
import { Card } from "./settings/rows";

const CATEGORY_ICON: Record<MarketCategory, Icon> = {
  Subtitles: Captions,
  Streams: Play,
  Metadata: Info,
};

/** Settings → Marketplace: add-ons by category, in the same rows as the rest of Settings. */
export function MarketplacePage() {
  const qc = useQueryClient();
  const { data: addons } = useAddons();
  const [query, setQuery] = useState("");
  const { addons: market } = useMarketplace();

  const install = useMutation({
    mutationFn: api.installAddon,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.addons });
      qc.invalidateQueries({ queryKey: ["streams"] });
    },
  });

  const installedIds = useMemo(() => new Set(addons?.map((a) => a.manifest.id)), [addons]);
  const shown = useMemo(() => searchMarketplace(market, query), [market, query]);
  const groups = MARKET_CATEGORIES.map((c) => ({ category: c, items: shown.filter((a) => a.category === c) })).filter(
    (g) => g.items.length,
  );

  return (
    <div className="market">
      <SearchField value={query} onChange={setQuery} label="Search add-ons" placeholder="Search add-ons" data-setting="marketplace" />

      {groups.map(({ category, items }) => {
        const Cat = CATEGORY_ICON[category];
        return (
          <Card title={category} key={category}>
            {items.map((a) => {
              const installed = installedIds.has(a.manifestId);
              const busy = install.isPending && install.variables === a.install;
              return (
                <div className="settings-row market-row" key={a.manifestId}>
                  <Cat className="settings-row-icon" size={20} strokeWidth={1.9} />
                  <span className="settings-row-text">
                    <span className="settings-row-title">
                      {a.name}
                      {a.author !== a.name && <span className="market-author"> by {a.author}</span>}
                    </span>
                    <span className="market-about">{a.about}</span>
                    {a.setupRequired && !installed && (
                      <span className="market-about">
                        Set it up on its page, then paste the link it gives you into{" "}
                        <button className="settings-link" onClick={() => openSettings("addons")}>
                          Install from URL
                        </button>
                        .
                      </span>
                    )}
                  </span>
                  <span className="market-actions">
                    {a.configure && (installed || !a.setupRequired) && (
                      <Button onClick={() => void api.openExternal(a.configure!)}>
                        Configure
                      </Button>
                    )}
                    {installed ? (
                      <span className="market-installed">
                        <Check size={16} strokeWidth={2.25} /> Installed
                      </span>
                    ) : a.setupRequired ? (
                      // Its setup page hands back a personal link; that goes in Install from URL.
                      <Button
                        variant="primary"
                        title="Set it up on its own page, then paste the link it gives you under Add-ons → Install from URL"
                        onClick={() => void api.openExternal(a.configure!)}
                      >
                        Set Up
                      </Button>
                    ) : (
                      <Button variant="primary" disabled={busy} onClick={() => install.mutate(a.install)}>
                        {busy ? "Installing…" : "Install"}
                      </Button>
                    )}
                  </span>
                </div>
              );
            })}
          </Card>
        );
      })}

      {!groups.length && (
        <p className="market-empty">
          Nothing matches “{query.trim()}”. If you have an add-on's link,{" "}
          <button className="settings-link" onClick={() => openSettings("addons")}>
            install it from its URL
          </button>
          .
        </p>
      )}

      {install.isError && <p className="settings-error">{String(install.error)}</p>}

      <p className="settings-footer">
        Polarity doesn't provide or endorse third-party add-ons. Add-ons you install from a link are your own choice,
        and you're responsible for what they access. Know a good one?{" "}
        <button className="settings-link" onClick={() => void api.openExternal(MARKETPLACE_REPO)}>
          Suggest it on GitHub
        </button>
        .
      </p>
    </div>
  );
}
