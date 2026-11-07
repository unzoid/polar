import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/api";
import { Button } from "../ui/Button";

/** A code to show, as the services' device sign-ins give it (Trakt #85, Simkl #86). */
export interface ShownCode {
  userCode: string;
  /** Where to enter the code; shown without its https://. */
  verificationUrl: string;
  /** What "Open …" opens: the same page, with the code filled in when the service offers that. */
  openUrl?: string;
}

/** How a sign-in ended: linked, or why not (a key of `why`). */
export type SignInEnd<Why extends string> = { linked: true } | { linked: false; why: Why };

type Step<Code, Why extends string> =
  { at: "idle" } | { at: "asking" } | { at: "code"; code: Code } | { at: "linking" } | { at: "failed"; why: Why | "unreachable" };

export interface DeviceCodeSignInProps<Code extends ShownCode, Why extends string> {
  /** The service's name, as the row says it. */
  service: string;
  /** What the row says before a code is asked for. */
  intro: string;
  /** Asks the service for a code; throws when it can't be reached. */
  start: () => Promise<Code>;
  /**
   * Waits until the user allowed `code` on the service's site (calls `linking` once it did, before
   * linking the profile), or the sign-in ended without a link. Throws when the service can't be reached.
   */
  finish: (code: Code, signal: AbortSignal, linking: () => void) => Promise<SignInEnd<Why>>;
  /** What each way of failing says; "unreachable" is said for the service when left out. */
  why: Record<Why, string> & Partial<Record<"unreachable", string>>;
}

/**
 * A service's device code sign-in: a short code to enter on the service's site from any browser or
 * phone, while Polarity waits for the service to say it was allowed. Closing the row stops the wait.
 */
export function DeviceCodeSignIn<Code extends ShownCode, Why extends string>({ service, intro, start, finish, why }: DeviceCodeSignInProps<Code, Why>) {
  const [step, setStep] = useState<Step<Code, Why>>({ at: "idle" });
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const go = async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setStep({ at: "asking" });
    let code: Code;
    try {
      code = await start();
    } catch {
      if (!controller.signal.aborted) setStep({ at: "failed", why: "unreachable" });
      return;
    }
    if (controller.signal.aborted) return;
    setStep({ at: "code", code });
    try {
      const end = await finish(code, controller.signal, () => !controller.signal.aborted && setStep({ at: "linking" }));
      if (controller.signal.aborted) return;
      if (!end.linked) setStep({ at: "failed", why: end.why });
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
          Go to <span className="settings-url">{code.verificationUrl.replace(/^https:\/\//, "")}</span> on any browser or phone, sign in to {service} and enter
          this code:
        </p>
        <p className="device-code" aria-label={`${service} code`}>
          {code.userCode}
        </p>
        <div className="settings-expand-form">
          <Button variant="glass" onClick={() => void api.openExternal(code.openUrl ?? code.verificationUrl)}>
            Open {service}
          </Button>
          <Button variant="glass" onClick={cancel}>
            Cancel
          </Button>
        </div>
        <p className="settings-expand-text t-caption" role="status">
          Waiting for you to allow Polarity on {service}…
        </p>
      </>
    );
  }

  const failure =
    step.at === "failed"
      ? step.why === "unreachable"
        ? (why.unreachable ?? `Couldn't reach ${service}. Check your connection and try again.`)
        : why[step.why]
      : null;
  return (
    <>
      <p className="settings-expand-text">{intro}</p>
      <div className="settings-expand-form">
        <Button variant="primary" disabled={step.at === "asking" || step.at === "linking"} onClick={() => void go()}>
          {step.at === "asking" ? "Getting a code…" : step.at === "linking" ? "Linking…" : step.at === "failed" ? "Get a new code" : "Get a code"}
        </Button>
      </div>
      {failure && (
        <p className="settings-expand-text settings-error" role="alert">
          {failure}
        </p>
      )}
    </>
  );
}
