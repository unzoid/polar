import { call, inShell, on, type Unlisten } from "./bridge";
import { os, type Os } from "./device";

type LinkBridge = {
  /** Messages to Android's activity, which only the app's own pages get (gen/android MainActivity.kt). */
  polarActions?: { postMessage?: (message: string) => void };
  /** The same calls where the web view is too old for messages; every frame sees this one. */
  polarDevice?: { linksReady?: () => void; setStremioLinks?: (on: boolean) => void };
};

/**
 * Android's activity, where there is one: the page listens (the activity then sends the links it has, and each
 * later one, as `polar-deep-link` events), and turning the activity alias that receives stremio:// links on or
 * off (#163).
 */
function android(): { linksReady: () => void; setStremioLinks: (on: boolean) => void } | null {
  if (typeof window === "undefined") return null;
  const { polarActions: actions, polarDevice: device } = window as LinkBridge;
  if (typeof actions?.postMessage === "function") {
    const post = (m: string) => actions.postMessage?.(m);
    return { linksReady: () => post("links-ready"), setStremioLinks: (on) => post(on ? "stremio-links:on" : "stremio-links:off") };
  }
  if (device?.linksReady && device.setStremioLinks)
    return { linksReady: () => device.linksReady?.(), setStremioLinks: (on) => device.setStremioLinks?.(on) };
  return null;
}

/**
 * polarity:// links opened from outside (#153), as the shell keeps them (src-tauri/src/deep_link.rs),
 * and stremio:// links when the user lets them come here (#163): the ones that came before this
 * listened (the link that started the app), then each as it comes. On Android the activity keeps
 * them until the page says it listens (`links-ready`), then sends them as `polar-deep-link` events.
 * Untrusted text: lib/deepLink parses it.
 */
export async function onDeepLinks(handler: (link: string) => void): Promise<Unlisten> {
  const activity = android();
  if (activity) {
    const take = (e: Event) => {
      const links: unknown = (e as CustomEvent).detail;
      if (Array.isArray(links)) links.forEach((l) => typeof l === "string" && handler(l));
    };
    window.addEventListener("polar-deep-link", take);
    activity.linksReady();
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
  if (os === "android") return android() ? "android" : null;
  return inShell && os !== "ios" ? os : null;
}

/** Makes this device send stremio:// links to Polarity, or stop (src-tauri/src/stremio_links.rs). */
export async function setStremioLinks(on: boolean): Promise<void> {
  const activity = android();
  if (activity) return activity.setStremioLinks(on);
  if (stremioLinksOs()) await call<void>("stremio_links_set", { on });
}
