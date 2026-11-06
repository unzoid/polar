/**
 * CAPTCHA on sign-in (#110), through Supabase Auth's own support: Cloudflare Turnstile. Nothing
 * of it loads until the server refuses to send a code without one (`captcha_needed`), so with
 * CAPTCHA off in the Supabase dashboard sign-in is as before. The site key is built in from
 * `VITE_CAPTCHA_SITE_KEY` (docs/supabase-storage.md §8); without one the app says it can't show the check.
 */
export const CAPTCHA_SITE_KEY = (import.meta.env.VITE_CAPTCHA_SITE_KEY as string | undefined) || undefined;

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export interface Turnstile {
  render(
    el: HTMLElement,
    options: {
      sitekey: string;
      theme?: "dark" | "light" | "auto";
      callback(token: string): void;
      "error-callback"?(): void;
      "expired-callback"?(): void;
    },
  ): string;
  remove(id: string): void;
}

let loading: Promise<Turnstile> | null = null;

/** Turnstile's script, loaded once; a failed load is tried again next time. */
export function loadTurnstile(): Promise<Turnstile> {
  loading ??= new Promise<Turnstile>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => {
      const t = (window as { turnstile?: Turnstile }).turnstile;
      if (t) resolve(t);
      else reject(new Error("The check didn't load."));
    };
    script.onerror = () => {
      script.remove();
      reject(new Error("The check couldn't be loaded. Check your connection."));
    };
    document.head.appendChild(script);
  }).catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}
