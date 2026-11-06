import { useEffect, useRef, useState } from "react";
import { CAPTCHA_SITE_KEY, loadTurnstile } from "../../lib/account/captcha";
import { errorMessage } from "../../lib/errors";

/**
 * The check the server asked for before it sends a code (#110; lib/account/captcha.ts): Turnstile's
 * widget, which hands back a one-use token. Mounted only after a `captcha_needed`.
 */
export function Captcha({ onToken }: { onToken: (token: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const done = useRef(onToken);
  done.current = onToken;

  useEffect(() => {
    if (!CAPTCHA_SITE_KEY) return;
    let id: string | undefined;
    let gone = false;
    loadTurnstile().then(
      (t) => {
        if (gone || !box.current) return;
        id = t.render(box.current, {
          sitekey: CAPTCHA_SITE_KEY!,
          theme: "dark",
          callback: (token) => done.current(token),
          "error-callback": () => setFailed("The check didn't go through. Try again."),
          "expired-callback": () => setFailed("The check expired. Try again."),
        });
      },
      (e) => !gone && setFailed(errorMessage(e)),
    );
    return () => {
      gone = true;
      if (id) void loadTurnstile().then((t) => t.remove(id!));
    };
  }, []);

  if (!CAPTCHA_SITE_KEY) {
    return (
      <p className="auth-error" role="alert">
        This server asks for a check before it sends a code, and this version of Polarity wasn't built with one.
      </p>
    );
  }
  return (
    <div className="auth-captcha">
      <div ref={box} />
      {failed && (
        <p className="auth-error" role="alert">
          {failed}
        </p>
      )}
    </div>
  );
}
