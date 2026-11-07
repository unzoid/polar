import { useEffect } from "react";
import { useAccount } from "../lib/account";
import { parseDeepLink } from "../lib/deepLink";
import { joinFromLink } from "../lib/party";
import { onDeepLinks } from "../lib/platform";
import { useRouter } from "../lib/router";

/**
 * polarity:// links from the website's pages (#153): a title opens its page, a party link asks to
 * join (lib/party/discordDesk.ts). Mounted with the app, so a link that started Polarity waits in
 * the shell until a profile is open.
 */
export function DeepLinks() {
  const { navigate } = useRouter();
  const { profile } = useAccount();
  const me = profile ? { name: profile.name, avatar: profile.avatar } : null;
  const meKey = me ? `${me.name}\n${me.avatar}` : "";
  useEffect(() => {
    let stop: (() => void) | null = null;
    let gone = false;
    void onDeepLinks((raw) => {
      const link = parseDeepLink(raw);
      if (link?.kind === "title") navigate({ name: "detail", type: link.type, id: link.id });
      else if (link?.kind === "party") joinFromLink(link.token, me);
    }).then((un) => (gone ? un() : (stop = un)));
    return () => {
      gone = true;
      stop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigate, meKey]);
  return null;
}
