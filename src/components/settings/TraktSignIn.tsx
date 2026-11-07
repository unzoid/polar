import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { linkTrakt, startDeviceSignIn, waitForDeviceSignIn, type DeviceCode } from "../../lib/trakt";
import { Button } from "../ui/Button";

type Step =
  | { at: "idle" }
  | { at: "asking" }
  | { at: "code"; code: DeviceCode }
  | { at: "linking" }
  | { at: "failed"; why: "denied" | "expired" | "unreachable" | "refused" };

const WHY: Record<Extract<Step, { at: "failed" }>["why"], string> = {
  denied: "The code was declined on Trakt. Get a new code to try again.",
  expired: "The code ran out before it was entered. Get a new code to try again.",
  unreachable: "Couldn't reach Trakt. Check your connection and try again.",
  refused: "Trakt didn't accept the sign-in. If you already use other Trakt apps, Trakt may limit how many a free account can connect.",
};

/**
 * Trakt's device code sign-in (#85): a short code to enter at trakt.tv/activate from any browser or
 * phone, while Polarity waits for Trakt to say it was allowed. Closing the row stops the wait.
 */
export function TraktSignIn({ space }: { space: string | null }) {
  const [step, setStep] = useState<Step>({ at: "idle" });
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const start = async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setStep({ at: "asking" });
    let code: DeviceCode;
    try {
      code = await startDeviceSignIn();
    } catch {
      if (!controller.signal.aborted) setStep({ at: "failed", why: "unreachable" });
      return;
    }
    if (controller.signal.aborted) return;
    setStep({ at: "code", code });
    try {
      const result = await waitForDeviceSignIn(code, { signal: controller.signal });
      if (controller.signal.aborted) return;
      if (result.state !== "allowed") {
        setStep({ at: "failed", why: result.state === "denied" ? "denied" : result.state === "expired" ? "expired" : "refused" });
        return;
      }
      setStep({ at: "linking" });
      await linkTrakt(space, result.tokens);
    } catch {
      if (!controller.signal.aborted) setStep({ at: "failed", why: "unreachable" });
    }
  };

  const cancel = () => {
    abort.current?.abort();
    setStep({ at: "idle" });
  };

  if (step.at === "code") {
    const { code } = step;
    return (
      <>
        <p className="settings-expand-text">
          Go to <span className="settings-url">{code.verificationUrl.replace(/^https:\/\//, "")}</span> on any browser or phone, sign in to Trakt and
          enter this code:
        </p>
        <p className="trakt-code" aria-label="Trakt code">
          {code.userCode}
        </p>
        <div className="settings-expand-form">
          <Button variant="glass" onClick={() => void api.openExternal(code.verificationUrl)}>
            Open Trakt
          </Button>
          <Button variant="glass" onClick={cancel}>
            Cancel
          </Button>
        </div>
        <p className="settings-expand-text t-caption" role="status">
          Waiting for you to allow Polarity on Trakt…
        </p>
      </>
    );
  }

  return (
    <>
      <p className="settings-expand-text">
        Polarity shows a short code to enter on Trakt's site from any browser or phone. The sign-in stays on this device.
      </p>
      <div className="settings-expand-form">
        <Button variant="primary" disabled={step.at === "asking" || step.at === "linking"} onClick={() => void start()}>
          {step.at === "asking" ? "Getting a code…" : step.at === "linking" ? "Linking…" : step.at === "failed" ? "Get a new code" : "Get a code"}
        </Button>
      </div>
      {step.at === "failed" && (
        <p className="settings-expand-text settings-error" role="alert">
          {WHY[step.why]}
        </p>
      )}
    </>
  );
}
