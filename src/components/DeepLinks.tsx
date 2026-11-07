import { useEffect, useRef, useState } from "react";
import { useAccount } from "../lib/account";
import { anilistForMal } from "../lib/anime";
import { api } from "../lib/api";
import { parseDeepLink, titleRoute } from "../lib/deepLink";
import { joinFromLink, offerTogether } from "../lib/party";
import { onDeepLinks } from "../lib/platform";
import { useRouter } from "../lib/router";
import { useLayer } from "../lib/ui";
import { Button } from "./ui/Button";

const lookups = { imdbForTmdb: api.imdbForTmdb, anilistForMal: (id: number) => anilistForMal(id) };

/**
 * polarity:// links from the website's pages (#153, #208): a title opens its page (found by its TMDB,
 * AniList or MyAnimeList id first when that's what the link carries), a party link asks to join
 * (lib/party/discordDesk.ts), a video link asks to watch it together (lib/party/together.ts). Mounted
 * with the app, so a link that started Polarity waits in the shell until a profile is open.
 */
export function DeepLinks() {
  const { navigate } = useRouter();
  const account = useAccount();
  const [problem, setProblem] = useState<string | null>(null);
  // Watch parties need an account (as the profile menu's Join Watch Party).
  const profile = account.enabled && account.status !== "guest" ? account.profile : null;
  const me = profile ? { name: profile.name, avatar: profile.avatar } : null;
  const meKey = me ? `${me.name}\n${me.avatar}` : "";
  useEffect(() => {
    let stop: (() => void) | null = null;
    let gone = false;
    // Only the latest title link counts: an older one's lookup finishing late doesn't take over.
    let latest = 0;
    void onDeepLinks((raw) => {
      const link = parseDeepLink(raw);
      if (!link) return;
      if (link.kind === "party") return joinFromLink(link.token, me);
      if (link.kind === "together") return offerTogether(link, me);
      const n = ++latest;
      void titleRoute(link, lookups).then((to) => {
        if (gone || n !== latest) return;
        if (typeof to === "string") setProblem(to);
        else navigate(to);
      });
    }).then((un) => (gone ? un() : (stop = un)));
    return () => {
      gone = true;
      stop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, meKey]);
  return problem ? <LinkProblem text={problem} onClose={() => setProblem(null)} /> : null;
}

function LinkProblem({ text, onClose }: { text: string; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useLayer(root, true, onClose);
  return (
    <div className="party-link-confirm" role="alertdialog" aria-modal="true" aria-labelledby="deep-link-problem" ref={root} tabIndex={-1} data-layer data-nav-scope>
      <div className="party-link-card">
        <h2 id="deep-link-problem" className="t-title2">
          Couldn't open that title
        </h2>
        <p className="t-callout" data-testid="deep-link-problem">
          {text}
        </p>
        <div className="player-status-actions">
          <Button variant="primary" onClick={onClose} autoFocus>
            OK
          </Button>
        </div>
      </div>
    </div>
  );
}
