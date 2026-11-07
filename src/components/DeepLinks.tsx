import { useEffect } from "react";
import { useAccount } from "../lib/account";
import { api } from "../lib/api";
import { offerAddon, openStremioLink, parseDeepLink, showLinkNote } from "../lib/deepLink";
import { joinFromLink } from "../lib/party";
import { onDeepLinks, setStremioLinks } from "../lib/platform";
import { getPrefs } from "../lib/settings";
import { useRouter } from "../lib/router";
import { StremioLinks } from "./StremioLinks";

let registrationChecked = false;

/**
 * polarity:// links from the website's pages (#153): a title opens its page, a party link asks to
 * join (lib/party/discordDesk.ts). Mounted with the app, so a link that started Polarity waits in
 * the shell until a profile is open.
 *
 * stremio:// links (#163), when Settings → Add-ons → Open Stremio links in Polarity is on: an
 * add-on's install link asks first (StremioLinks), a title link opens the title or the episode,
 * anything else opens Home with a note.
 */
export function DeepLinks({ tv }: { tv: boolean }) {
  const { navigate, tab } = useRouter();
  const { profile } = useAccount();
  const me = profile ? { name: profile.name, avatar: profile.avatar } : null;
  const meKey = me ? `${me.name}\n${me.avatar}` : "";
  useEffect(() => {
    let stop: (() => void) | null = null;
    let gone = false;
    void onDeepLinks((raw) => {
      const opened = openStremioLink(raw, {
        enabled: getPrefs().stremioLinks,
        openTitle: (type, id, episode) => navigate({ name: "detail", type, id, episode }),
        home: (note) => {
          tab({ name: "home" });
          showLinkNote(note);
        },
        offerAddon: (url) => offerAddon(url, { preview: api.previewAddon, install: api.installAddon }),
      });
      if (opened) return;
      const link = parseDeepLink(raw);
      if (link?.kind === "title") navigate({ name: "detail", type: link.type, id: link.id });
      else if (link?.kind === "party") joinFromLink(link.token, me);
    }).then((un) => (gone ? un() : (stop = un)));
    return () => {
      gone = true;
      stop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, tab, meKey]);
  // Once a start: the registration follows the app when it moves (an update, an AppImage), and a
  // turned-off setting gives the links back if something took them for Polarity.
  useEffect(() => {
    if (registrationChecked) return;
    registrationChecked = true;
    void setStremioLinks(getPrefs().stremioLinks).catch(() => {});
  }, []);
  return <StremioLinks tv={tv} />;
}
