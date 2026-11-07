import { call, inShell, on, type Unlisten } from "./bridge";

/**
 * polarity:// links opened from outside (#153), as the shell keeps them (src-tauri/src/deep_link.rs):
 * the ones that came before this listened (the link that started the app), then each as it comes.
 * Untrusted text: lib/deepLink parses it.
 */
export async function onDeepLinks(handler: (link: string) => void): Promise<Unlisten> {
  if (!inShell) return () => {};
  const take = () =>
    void call<string[]>("deep_links_take").then(
      (links) => links.forEach(handler),
      () => {},
    );
  const unlisten = await on("deep-link", take);
  take();
  return unlisten;
}
