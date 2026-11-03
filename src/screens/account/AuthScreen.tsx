import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { ease, springs } from "../../lib/motion";
import logo from "../../assets/polarity-white.png";
import { BusyLabel } from "../../components/BusyLabel";
import { AccountError } from "../../lib/account";
import { useAccount } from "../../lib/account/AccountProvider";
import { AccountShell } from "./AccountShell";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The server only sends a new code once a minute. */
const RESEND_AFTER_S = 60;

type Failure = { message: string; signedIn?: boolean };
type Step = "start" | "email" | "code";

/**
 * Passwordless sign-in, laid out like Linear's: a narrow centred column on a
 * dark vertical gradient - the mark, one short question, pill buttons - one
 * step at a time. Start → "What's your email address?" → "Check your email"
 * with the code field. New emails get an account automatically.
 *
 * Changing step, as Linear does: everything but the logo fades out with a
 * barely-there sink (98%), then the next step fades in and settles to full
 * size on a gentle spring, all of it together.
 */
export function AuthScreen() {
  const account = useAccount();
  const reduce = useReducedMotion();
  const [step, setStep] = useState<Step>("start");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentAt, setSentAt] = useState(0);
  const wait = useCountdown(sentAt, RESEND_AFTER_S);

  // Changing step: AnimatePresence plays the old step's exit, then mounts the next.
  const go = (s: Step) => {
    setError(null);
    setStep(s);
  };

  const attempt = async (fn: () => Promise<void>, { signedIn = false } = {}) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      const isCodeError = e instanceof AccountError && (e.code === "invalid_code" || e.code === "invalid_email");
      setError({
        message: e instanceof Error ? e.message : String(e),
        // A code was accepted but setting up profiles failed: retrying the
        // same code won't work, but resuming the session will.
        signedIn: signedIn && !isCodeError,
      });
    } finally {
      setBusy(false);
    }
  };

  const send = () =>
    attempt(async () => {
      await account.sendCode(email.trim());
      setSentAt(Date.now());
      setCode("");
      if (step !== "code") go("code");
    });

  const submitEmail = (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return setError({ message: "Enter a valid email address." });
    void send();
  };

  const verify = (value: string) => {
    if (value.length < 6) return setError({ message: "Enter the code from the email." });
    void attempt(() => account.verifyCode(email.trim(), value), { signedIn: true });
  };

  const skip = account.canCancelSignIn ? account.cancelSignIn : account.continueAsGuest;

  return (
    <AccountShell plain>
      <div className="auth">
        <img className="auth-mark" src={logo} alt="Polarity" draggable={false} />
        <AnimatePresence mode="wait" initial={false}>
        <motion.div
          className="auth-body"
          key={step}
          // Nearly in place: a 2% sink while fading out, then the next step
          // fades in and springs from 98% to full size with a hint of overshoot.
          // (Scale props, not a transform string: nothing else runs on this screen.)
          // Scaled from the top edge, so the title stays on its line and only
          // the lower part of the step gives.
          style={{ transformOrigin: "50% 0%" }}
          initial={{ opacity: 0, scale: reduce ? 1 : 0.98 }}
          animate={{ opacity: 1, scale: 1, transition: { scale: springs.settle, opacity: { duration: 0.29, ease: ease.out } } }}
          exit={{ opacity: 0, scale: reduce ? 1 : 0.98, transition: { duration: 0.21, ease: ease.out } }}
        >

        {step === "start" && (
          <>
            <h1 className="auth-title">Sign in to Polarity</h1>
            <div className="auth-actions">
              <button className="auth-btn auth-btn-primary" onClick={() => go("email")}>
                Continue with email
              </button>
              <button className="auth-btn" onClick={skip}>
                Continue without an account
              </button>
            </div>
            <p className="auth-fine">
              An account keeps your profiles, library, watch history and settings in sync across devices. New here? Signing in
              creates one.
            </p>
          </>
        )}

        {step === "email" && (
          <form className="auth-form" onSubmit={submitEmail} noValidate>
            <h1 className="auth-title">What's your email address?</h1>
            <div className="auth-actions">
              <Input
                aria-label="Email address"
                type="email"
                autoComplete="email"
                placeholder="Enter your email address…"
                value={email}
                onValue={setEmail}
                autoFocus
              />
              <button className="auth-btn" type="submit" disabled={busy} aria-busy={busy}>
                <BusyLabel busy={busy}>Continue with email</BusyLabel>
              </button>
            </div>
            <ErrorLine error={error} />
            <button type="button" className="auth-link" onClick={() => go("start")}>
              Back to sign in
            </button>
          </form>
        )}

        {step === "code" && (
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              verify(code);
            }}
            noValidate
          >
            <h1 className="auth-title">Check your email</h1>
            <p className="auth-sub">
              We've sent you a temporary login code.
              <br />
              Please check your inbox at <strong>{email.trim()}</strong>.
            </p>
            <div className="auth-actions">
              <Input
                aria-label="Login code"
                className="auth-code"
                placeholder="Enter code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={10}
                value={code}
                onValue={(v) => setCode(v.replace(/\D/g, ""))}
                onPaste={(e) => {
                  const pasted = e.clipboardData.getData("text").replace(/\D/g, "");
                  if (pasted.length >= 6) {
                    e.preventDefault();
                    setCode(pasted);
                    verify(pasted);
                  }
                }}
                autoFocus
              />
              <button className="auth-btn auth-btn-primary" type="submit" disabled={busy || !code} aria-busy={busy}>
                <BusyLabel busy={busy}>Continue with login code</BusyLabel>
              </button>
            </div>
            <ErrorLine
              error={error}
              action={
                error?.signedIn ? (
                  <button type="button" className="auth-link" onClick={() => void attempt(account.resume)}>
                    Try again
                  </button>
                ) : null
              }
            />
            <button type="button" className="auth-link" onClick={() => go("email")}>
              Back to sign in
            </button>
            <button type="button" className="auth-link auth-link-quiet" onClick={() => void send()} disabled={busy || wait > 0}>
              {wait > 0 ? `Send a new code in ${wait}s` : "Didn't get it? Send a new code"}
            </button>
          </form>
        )}
        </motion.div>
        </AnimatePresence>
      </div>
    </AccountShell>
  );
}

function useCountdown(from: number, seconds: number) {
  const left = () => Math.max(0, Math.ceil(seconds - (Date.now() - from) / 1000));
  const [value, setValue] = useState(left);
  useEffect(() => {
    setValue(left());
    if (!from) return;
    const t = window.setInterval(() => {
      const v = left();
      setValue(v);
      if (v === 0) window.clearInterval(t);
    }, 1000);
    return () => window.clearInterval(t);
  }, [from, seconds]);
  return from ? value : 0;
}

/** A field with no label above it (the placeholder asks; aria-label names it), as Linear's. */
function Input({
  value,
  onValue,
  className,
  type = "text",
  ...rest
}: { value: string; onValue: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <input
      className={className ? `auth-input ${className}` : "auth-input"}
      type={type}
      value={value}
      onChange={(e) => onValue(e.target.value)}
      spellCheck={false}
      autoCapitalize="off"
      {...rest}
    />
  );
}

function ErrorLine({ error, action }: { error: Failure | null; action?: ReactNode }) {
  if (!error) return null;
  return (
    <div className="auth-error" role="alert">
      <span>{error.message}</span>
      {action}
    </div>
  );
}
