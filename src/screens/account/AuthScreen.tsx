import { ArrowLeft } from "../../components/icons";
import { useEffect, useId, useState, type FormEvent, type InputHTMLAttributes, type ReactNode } from "react";
import { BusyLabel } from "../../components/BusyLabel";
import { AccountError } from "../../lib/account";
import { useAccount } from "../../lib/account/AccountProvider";
import { AccountShell } from "./AccountShell";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The server only sends a new code once a minute. */
const RESEND_AFTER_S = 60;

type Failure = { message: string; signedIn?: boolean };

/**
 * Passwordless sign-in: enter your email, then the code we email you. New
 * emails get an account automatically, so there's no separate sign-up.
 */
export function AuthScreen() {
  const account = useAccount();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentAt, setSentAt] = useState(0);
  const wait = useCountdown(sentAt, RESEND_AFTER_S);

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
      await account.sendCode(email);
      setSentAt(Date.now());
      setCode("");
      setStep("code");
    });

  const submitEmail = (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(email.trim())) return setError({ message: "Enter a valid email address." });
    void send();
  };

  const verify = (value: string) => {
    if (value.length < 6) return setError({ message: "Enter the code from the email." });
    void attempt(() => account.verifyCode(email, value), { signedIn: true });
  };

  const back =
    step === "code"
      ? () => {
          setError(null);
          setStep("email");
        }
      : account.canCancelSignIn
        ? account.cancelSignIn
        : undefined;

  return (
    <AccountShell>
      <div className="auth">
        {back && (
          <button className="auth-back pressable" onClick={back}>
            <ArrowLeft size={16} strokeWidth={2.5} />
            Back
          </button>
        )}

        {step === "email" ? (
          <form className="auth-form" onSubmit={submitEmail} noValidate key="email">
            <h1 className="auth-title">Sign in or create an account</h1>
            <p className="auth-sub">We'll email you a code. No password needed.</p>
            <Field
              label="Email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onValue={setEmail}
              autoFocus
            />
            <ErrorLine error={error} />
            <SubmitButton busy={busy}>Continue</SubmitButton>
            <button type="button" className="auth-link auth-guest" onClick={account.continueAsGuest}>
              Continue without an account
            </button>
            <p className="auth-fine">
              An account keeps your profiles, library, watch history and settings in sync across devices.
            </p>
          </form>
        ) : (
          <form
            className="auth-form"
            onSubmit={(e) => {
              e.preventDefault();
              verify(code);
            }}
            noValidate
            key="code"
          >
            <h1 className="auth-title">Check your email</h1>
            <p className="auth-sub">
              We sent a code to <strong>{email}</strong>.
            </p>
            <Field
              label="Code"
              className="auth-code"
              placeholder="Enter the code"
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
            <SubmitButton busy={busy} disabled={!code}>
              Continue
            </SubmitButton>
            <div className="auth-row">
              <button type="button" className="auth-link" onClick={() => void send()} disabled={busy || wait > 0}>
                {wait > 0 ? `Send a new code in ${wait}s` : "Send a new code"}
              </button>
              <button type="button" className="auth-link" onClick={back}>
                Use a different email
              </button>
            </div>
            <p className="auth-fine">Can't find it? Check your spam folder.</p>
          </form>
        )}
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

function Field({
  label,
  type = "text",
  value,
  onValue,
  className,
  ...rest
}: { label: string; value: string; onValue: (v: string) => void } & Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange"
>) {
  const id = useId();
  return (
    <div className={className ? `auth-field ${className}` : "auth-field"}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onValue(e.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        {...rest}
      />
    </div>
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

function SubmitButton({ busy, disabled, children }: { busy: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button className="auth-primary pressable" type="submit" disabled={busy || disabled} aria-busy={busy}>
      <BusyLabel busy={busy}>{children}</BusyLabel>
    </button>
  );
}
