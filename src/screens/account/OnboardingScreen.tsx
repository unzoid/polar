import { useId, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { Avatar } from "../../components/Avatar";
import { BusyLabel } from "../../components/BusyLabel";
import { Check } from "../../components/icons";
import { AVATAR_GROUPS, AVATARS, type AvatarId } from "../../lib/account";
import { useAccount } from "../../lib/account/AccountProvider";
import { AccountShell } from "./AccountShell";

/** Arrow keys move through the icon grid, like a TV remote. */
function moveFocus(e: KeyboardEvent<HTMLElement>) {
  const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
  if (!step) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[role=radio]")];
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = items[(i + step + items.length) % items.length];
  if (next) {
    e.preventDefault();
    next.focus();
  }
}

/**
 * Right after a new account's code is confirmed: name the first profile
 * (names don't have to be unique) and pick its icon, then straight in.
 */
export function OnboardingScreen() {
  const account = useAccount();
  const nameId = useId();
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<AvatarId>(AVATARS[0].id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const trimmed = name.trim();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed) return setError("Choose a name for your profile.");
    setBusy(true);
    setError(null);
    try {
      await account.createFirstProfile({ name: trimmed, avatar });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <AccountShell
      header={
        <button className="account-bar-link" onClick={() => void account.signOut()} disabled={busy}>
          Use a different email
        </button>
      }
    >
      <form className="onboard" onSubmit={submit} noValidate>
        <div className="onboard-head">
          <span className="onboard-preview" key={avatar}>
            <Avatar id={avatar} />
          </span>
          <div className="onboard-intro">
            <h1 className="auth-title">Set up your profile</h1>
            <p className="auth-sub">
              Pick a name and an icon. You can change both later, and add profiles for others.
            </p>
          </div>
        </div>

        <div className="auth-field">
          <label htmlFor={nameId}>Name</label>
          <input
            id={nameId}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="What should we call you?"
            maxLength={40}
            autoComplete="nickname"
            spellCheck={false}
            autoFocus
          />
        </div>

        <div className="onboard-icons">
          {AVATAR_GROUPS.map((g, gi) => (
            <section key={g.id} className="onboard-group" style={{ "--i": gi } as CSSProperties}>
              <h2>{g.name}</h2>
              <div className="onboard-row" role="radiogroup" aria-label={g.name} onKeyDown={moveFocus}>
                {AVATARS.filter((a) => a.group === g.id).map((a) => (
                  <button
                    type="button"
                    key={a.id}
                    role="radio"
                    aria-checked={a.id === avatar}
                    aria-label={a.id}
                    className="onboard-choice"
                    onClick={() => setAvatar(a.id)}
                  >
                    <Avatar id={a.id} />
                    {a.id === avatar && (
                      <span className="icon-choice-check">
                        <Check size={12} strokeWidth={3} />
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>

        {error && (
          <p className="auth-error" role="alert">
            {error}
          </p>
        )}
        <button className="auth-primary pressable" type="submit" disabled={busy || !trimmed} aria-busy={busy}>
          <BusyLabel busy={busy}>Continue</BusyLabel>
        </button>
      </form>
    </AccountShell>
  );
}
