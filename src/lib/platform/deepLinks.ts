import { call, inShell, on, type Unlisten } from "./bridge";
import { os, type Os } from "./device";

type LinkBridge = {
  polarDevice?: {
    /** The page listens: the activity sends the links it has, and each later one, as `polar-deep-link` events (gen/android MainActivity.kt). */
    linksReady?: () => void;
    /** Turns the activity alias that receives stremio:// links on or off (#163). */
    setStremioLinks?: (on: boolean) => void;
  };
};

const device = () => (typeof window === "undefined" ? undefined : (window as LinkBridge).polarDevice);

/**
 * polarity:// links opened from outside (#153), as the shell keeps them (src-tauri/src/deep_link.rs),
 * and stremio:// links when the user lets them come here (#163): the ones that came before this
 * listened (the link that started the app), then each as it comes. On Android the activity keeps
 * them until the page says it listens (`polarDevice.linksReady`), then sends them as `polar-deep-link` events.
 * Untrusted text: lib/deepLink parses it.
 */
export async function onDeepLinks(handler: (link: string) => void): Promise<Unlisten> {
  if (device()?.linksReady) {
    const take = (e: Event) => {
      const links: unknown = (e as CustomEvent).detail;
      if (Array.isArray(links)) links.forEach((l) => typeof l === "string" && handler(l));
    };
    window.addEventListener("polar-deep-link", take);
    device()?.linksReady?.();
    return () => window.removeEventListener("polar-deep-link", take);
  }
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

/** Where "Open Stremio links in Polarity" can work: the desktop app and Android, not iOS or a browser. */
export function stremioLinksOs(): Os | null {
  if (os === "android") return device()?.setStremioLinks ? "android" : null;
  return inShell && os !== "ios" ? os : null;
}

/** Makes this device send stremio:// links to Polarity, or stop (src-tauri/src/stremio_links.rs). */
export async function setStremioLinks(on: boolean): Promise<void> {
  const android = device()?.setStremioLinks;
  if (android) return void android.call(device(), on);
  if (stremioLinksOs()) await call<void>("stremio_links_set", { on });
}
