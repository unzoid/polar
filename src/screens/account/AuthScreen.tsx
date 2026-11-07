import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ease, springs } from "../../lib/ui";
import logo from "../../assets/polarity-white.png";
import { Button } from "../../components/ui/Button";
import { TextField, type TextFieldProps } from "../../components/ui/TextField";
import { AccountError, formatTvCode, useAccount, type TvSignInRequest } from "../../lib/account";
import { useTvMode } from "../../tv/tvMode";
import { api } from "../../lib/api";
import { PRIVACY_URL, TERMS_URL } from "../../lib/settings";
import { errorMessage } from "../../lib/errors";
import { AccountShell } from "./AccountShell";
import { Captcha } from "./Captcha";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The server only sends a new code once a minute. */
const RESEND_AFTER_S = 60;

type Failure = { message: string; signedIn?: boolean };
type Step = "start" | "email" | "code" | "device";

/**
 * Passwordless sign-in, laid out like Linear's: a narrow centred column on a
 * dark vertical gradient - the mark, one short question, pill buttons - one
 * step at a time. Start → "What's your email address?" → "Check your email"
 * with the code field. New emails get an account automatically. Or "Sign in with another device"
 * (first on a TV, #133): a code to approve on a phone or computer that's signed in.
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
  // Each time the server asks for a CAPTCHA (#110) a fresh one: a token works once.
  const [captcha, setCaptcha] = useState(0);
  const wait = useCountdown(sentAt, RESEND_AFTER_S);

  // Changing step: AnimatePresence plays the old step's exit, then mounts the next.
  const go = (s: Step) => {
    setError(null);
    setCaptcha(0);
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
        message: errorMessage(e),
        // A code was accepted but setting up profiles failed: retrying the
        // same code won't work, but resuming the session will.
        signedIn: signedIn && !isCodeError,
      });
    } finally {
      setBusy(false);
    }
  };

  const send = (captchaToken?: string) =>
    attempt(async () => {
      try {
        await account.sendCode(email.trim(), captchaToken);
      } catch (e) {
        if (!(e instanceof AccountError && e.code === "captcha_needed")) throw e;
        setCaptcha((n) => n + 1);
        return;
      }
      setCaptcha(0);
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

  const tv = useTvMode();
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
              {/* On a TV, typing an email with a remote is the slow way: the phone comes first. */}
              {tv && (
                <Button variant="accent" size="block" onClick={() => go("device")}>
                  Sign in with your phone
                </Button>
              )}
              <Button variant={tv ? undefined : "accent"} size="block" onClick={() => go("email")}>
                Continue with email
              </Button>
              {!tv && (
                <Button size="block" onClick={() => go("device")}>
                  Sign in with another device
                </Button>
              )}
              <Button size="block" onClick={skip}>
                Continue without an account
              </Button>
            </div>
            <p className="auth-fine">
              An account keeps your profiles, library, watch history and settings in sync across devices. New here? Signing in
              creates one.
            </p>
            <LegalLinks />
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
              <Button size="block" type="submit" disabled={busy} busy={busy}>
                Continue with email
              </Button>
            </div>
            {captcha > 0 && <Captcha key={captcha} onToken={(t) => void send(t)} />}
            <ErrorLine error={error} />
            <button type="button" className="auth-link" onClick={() => go("start")}>
              Back to sign in
            </button>
            <LegalLinks />
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
              <Button variant="accent" size="block" type="submit" disabled={busy || !code} busy={busy}>
                Continue with login code
              </Button>
            </div>
            {captcha > 0 && <Captcha key={captcha} onToken={(t) => void send(t)} />}
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

        {step === "device" && <DeviceStep tv={tv} onBack={() => go("start")} />}
        </motion.div>
        </AnimatePresence>
      </div>
    </AccountShell>
  );
}

type DeviceState =
  | { kind: "loading" }
  | { kind: "code"; request: TvSignInRequest }
  | { kind: "signing-in" }
  | { kind: "over"; message: string };

/**
 * Signing in from another device (#133): a code to enter on a phone or computer that's signed in,
 * until it's approved (the account then moves on to the profiles), denied or expired.
 */
function DeviceStep({ tv, onBack }: { tv: boolean; onBack: () => void }) {
  const account = useAccount();
  const [state, setState] = useState<DeviceState>({ kind: "loading" });
  const [round, setRound] = useState(0);
  useEffect(() => {
    const stop = new AbortController();
    setState({ kind: "loading" });
    void (async () => {
      try {
        const request = await account.tvSignIn.start();
        if (stop.signal.aborted) return;
        setState({ kind: "code", request });
        const end = await account.tvSignIn.wait(request, stop.signal);
        if (end === "denied") setState({ kind: "over", message: "The sign-in was denied on the other device." });
        else if (end === "expired") setState({ kind: "over", message: "That code has expired." });
        else if (end === "approved") setState({ kind: "signing-in" });
      } catch (e) {
        if (!stop.signal.aborted) setState({ kind: "over", message: errorMessage(e) });
      }
    })();
    return () => stop.abort();
    // `account` changes as sign-in moves on; one request per round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round]);
  const left = useLeft(state.kind === "code" ? state.request.expiresAt : 0);
  return (
    <div className="auth-form">
      <h1 className="auth-title">{tv ? "Sign in with your phone" : "Sign in with another device"}</h1>
      <p className="auth-sub">
        On a phone or computer that's signed in to Polarity, open <strong>Settings → Account → Sign in a TV</strong> and enter this code.
      </p>
      <div className="auth-device-code" aria-live="polite" data-state={state.kind}>
        {state.kind === "code" ? formatTvCode(state.request.code) : state.kind === "signing-in" ? "Signing in…" : state.kind === "loading" ? "········" : ""}
      </div>
      {state.kind === "code" && (
        <p className="auth-fine">
          Waiting for approval · the code expires in {Math.floor(left / 60)}:{String(left % 60).padStart(2, "0")}
        </p>
      )}
      {state.kind === "over" && (
        <>
          <ErrorLine error={{ message: state.message }} />
          <div className="auth-actions">
            <Button variant="accent" size="block" onClick={() => setRound((n) => n + 1)}>
              Get a new code
            </Button>
          </div>
        </>
      )}
      <button type="button" className="auth-link" onClick={onBack}>
        Back to sign in
      </button>
    </div>
  );
}

/** Seconds until `at` (epoch ms), counting down each second; 0 without one. */
function useLeft(at: number) {
  const left = () => Math.max(0, Math.ceil((at - Date.now()) / 1000));
  const [value, setValue] = useState(left);
  useEffect(() => {
    setValue(left());
    if (!at) return;
    const t = window.setInterval(() => setValue(left()), 1000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at]);
  return at ? value : 0;
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
function Input({ onValue, type = "text", ...rest }: { value: string; onValue: (v: string) => void } & Omit<TextFieldProps, "onChange" | "look">) {
  return <TextField look="block" type={type} onChange={onValue} spellCheck={false} autoCapitalize="off" {...rest} />;
}

/** The privacy policy and terms (#157), under the steps that create an account. */
function LegalLinks() {
  return (
    <p className="auth-legal">
      <button type="button" onClick={() => void api.openExternal(PRIVACY_URL)}>
        Privacy Policy
      </button>
      <span aria-hidden>·</span>
      <button type="button" onClick={() => void api.openExternal(TERMS_URL)}>
        Terms of Use
      </button>
    </p>
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
