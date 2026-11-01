import { ArrowLeft, Check, Edit, Plus } from "../../components/icons";
import { useState, type CSSProperties, type FormEvent, type KeyboardEvent } from "react";
import { Avatar } from "../../components/Avatar";
import { BusyLabel, BusyRing } from "../../components/BusyLabel";
import { AVATAR_GROUPS, AVATARS, nextAvatar, type AvatarId, type Profile } from "../../lib/account";
import { useAccount } from "../../lib/account/AccountProvider";
import { AccountShell } from "./AccountShell";

const MAX_PROFILES = 5;

type View = { name: "pick" | "manage" } | { name: "edit"; profile: Profile | null };

/** Left/right (and up/down) move between tiles, like a TV remote. */
function moveFocus(e: KeyboardEvent<HTMLElement>) {
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
  if (!step) return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>("[data-tile]:not(:disabled)")];
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = items[i === -1 ? 0 : (i + step + items.length) % items.length];
  if (next) {
    e.preventDefault();
    next.focus();
  }
}

/** "Who's watching?" plus managing profiles (add, rename, icon, delete). */
export function ProfilesScreen({ initial = "pick" }: { initial?: "pick" | "manage" }) {
  const account = useAccount();
  const [view, setView] = useState<View>({ name: initial });
  const [entering, setEntering] = useState<string | null>(null);
  const managing = view.name === "manage";

  if (view.name === "edit") {
    return (
      <AccountShell>
        <ProfileEditor
          profile={view.profile}
          canDelete={!!view.profile && account.profiles.length > 1}
          done={() => setView({ name: "manage" })}
        />
      </AccountShell>
    );
  }

  const choose = async (p: Profile) => {
    if (managing) return setView({ name: "edit", profile: p });
    setEntering(p.id);
    try {
      await account.chooseProfile(p);
    } finally {
      setEntering(null);
    }
  };

  const highlighted = account.profiles.find((p) => p.id === account.lastProfileId)?.id ?? account.profiles[0]?.id;

  return (
    <AccountShell
      header={
        <button className="account-bar-link" onClick={() => void account.signOut()}>
          Sign Out
        </button>
      }
    >
      <div className="profiles" key={view.name}>
        <h1 className="profiles-title">{managing ? "Manage Profiles" : "Who's watching?"}</h1>
        <ul className="profiles-grid" onKeyDown={moveFocus}>
          {account.profiles.map((p, i) => (
            <li key={p.id} style={{ "--i": i } as CSSProperties}>
              <button
                data-tile
                className="profile-tile"
                data-managing={managing}
                data-entering={entering === p.id}
                onClick={() => void choose(p)}
                disabled={!!entering}
                autoFocus={p.id === highlighted}
                aria-label={managing ? `Edit ${p.name}` : p.name}
              >
                <span className="profile-tile-art">
                  <Avatar id={p.avatar} />
                  {managing && (
                    <span className="profile-tile-overlay">
                      <span className="profile-tile-pencil">
                        <Edit size={22} strokeWidth={2.25} />
                      </span>
                    </span>
                  )}
                  {entering === p.id && (
                    <span className="profile-tile-overlay">
                      <BusyRing size={28} />
                    </span>
                  )}
                </span>
                <span className="profile-tile-name">{p.name}</span>
              </button>
            </li>
          ))}
          {account.profiles.length < MAX_PROFILES && (
            <li style={{ "--i": account.profiles.length } as CSSProperties}>
              <button
                data-tile
                className="profile-tile profile-add"
                onClick={() => setView({ name: "edit", profile: null })}
                disabled={!!entering}
              >
                <span className="profile-tile-art">
                  <Plus size={52} strokeWidth={1.5} />
                </span>
                <span className="profile-tile-name">Add Profile</span>
              </button>
            </li>
          )}
        </ul>
        {managing ? (
          <button className="profiles-done pressable" onClick={() => setView({ name: "pick" })}>
            Done
          </button>
        ) : (
          <button className="profiles-manage pressable" onClick={() => setView({ name: "manage" })}>
            <Edit size={16} strokeWidth={2.25} />
            Manage Profiles
          </button>
        )}
      </div>
    </AccountShell>
  );
}

export function ProfileEditor({
  profile,
  canDelete,
  done,
}: {
  profile: Profile | null;
  canDelete: boolean;
  done: () => void;
}) {
  const account = useAccount();
  const [name, setName] = useState(profile?.name ?? "");
  const [avatar, setAvatar] = useState<AvatarId>(
    profile?.avatar ?? nextAvatar(account.profiles.map((p) => p.avatar)),
  );
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      done();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) return setError("Give the profile a name.");
    void run(() =>
      profile
        ? account.updateProfile(profile.id, { name: trimmed, avatar })
        : account.createProfile({ name: trimmed, avatar }),
    );
  };

  if (picking) {
    return (
      <IconPicker
        name={name.trim() || "New profile"}
        current={avatar}
        taken={account.profiles.filter((p) => p.id !== profile?.id).map((p) => p.avatar)}
        onPick={(id) => {
          setAvatar(id);
          setPicking(false);
        }}
        onBack={() => setPicking(false)}
      />
    );
  }

  return (
    <form className="profile-editor" onSubmit={save}>
      <h1 className="profiles-title">{profile ? "Edit Profile" : "Add Profile"}</h1>
      <div className="profile-editor-body">
        <button
          type="button"
          className="profile-editor-avatar"
          onClick={() => setPicking(true)}
          aria-label="Change profile icon"
        >
          <Avatar id={avatar} />
          <span className="profile-editor-avatar-badge">
            <Edit size={14} strokeWidth={2.5} />
          </span>
        </button>
        <div className="profile-editor-fields">
          <input
            className="profile-editor-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            maxLength={40}
            autoFocus
            spellCheck={false}
            aria-label="Profile name"
          />
          <button type="button" className="auth-link" onClick={() => setPicking(true)}>
            Change Icon
          </button>
          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
      <div className="profile-editor-actions">
        <button type="submit" className="profiles-done pressable" disabled={busy}>
          <BusyLabel busy={busy}>Save</BusyLabel>
        </button>
        <button type="button" className="profiles-manage pressable" onClick={done} disabled={busy}>
          Cancel
        </button>
        {canDelete &&
          profile &&
          (confirmDelete ? (
            <button
              type="button"
              className="profiles-manage profiles-danger pressable"
              disabled={busy}
              onClick={() => void run(() => account.deleteProfile(profile.id))}
            >
              Delete Profile and History
            </button>
          ) : (
            <button
              type="button"
              className="profiles-manage pressable"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
            >
              Delete Profile
            </button>
          ))}
      </div>
    </form>
  );
}

/** Full-page icon chooser, grouped into rows. */
function IconPicker({
  name,
  current,
  taken,
  onPick,
  onBack,
}: {
  name: string;
  current: AvatarId;
  taken: string[];
  onPick: (id: AvatarId) => void;
  onBack: () => void;
}) {
  return (
    <div className="icon-picker">
      <header className="icon-picker-head">
        <button type="button" className="auth-back pressable" onClick={onBack}>
          <ArrowLeft size={16} strokeWidth={2.5} />
          Back
        </button>
        <div className="icon-picker-heading">
          <h1 className="profiles-title">Choose an Icon</h1>
          <span className="icon-picker-for">
            {name}
            <Avatar id={current} />
          </span>
        </div>
      </header>
      {AVATAR_GROUPS.map((g) => (
        <section key={g.id} className="icon-picker-group">
          <h2>{g.name}</h2>
          <div className="icon-picker-row" role="radiogroup" aria-label={g.name} onKeyDown={moveFocus}>
            {AVATARS.filter((a) => a.group === g.id).map((a) => (
              <button
                type="button"
                key={a.id}
                data-tile
                role="radio"
                aria-checked={a.id === current}
                aria-label={a.id}
                className="icon-choice"
                onClick={() => onPick(a.id)}
                autoFocus={a.id === current}
              >
                <Avatar id={a.id} />
                {a.id === current ? (
                  <span className="icon-choice-check">
                    <Check size={14} strokeWidth={3} />
                  </span>
                ) : (
                  taken.includes(a.id) && <span className="icon-choice-taken">In use</span>
                )}
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
