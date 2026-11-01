import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { backend, nextAvatar, type AccountUser, type Profile, type ProfileInput } from "./index";
import { refreshLocalViews, sync } from "./sync";

/**
 *  - loading:   restoring the session
 *  - signed-out: show the sign-in screen
 *  - guest:     using Rustio without an account (local library only)
 *  - profiles:  signed in, "Who's watching?"
 *  - ready:     signed in with a profile; the app is showing
 */
export type AccountStatus = "loading" | "signed-out" | "guest" | "profiles" | "ready";

interface Account {
  /** False when no provider is configured: no sign-in UI anywhere. */
  enabled: boolean;
  status: AccountStatus;
  user: AccountUser | null;
  profiles: Profile[];
  profile: Profile | null;
  /** The profile picked last time, highlighted on "Who's watching?". */
  lastProfileId: string | null;
  /** Guest asked to sign in; the sign-in screen can go back to the app. */
  canCancelSignIn: boolean;

  /** Email a sign-in code (new emails get an account automatically). */
  sendCode(email: string): Promise<void>;
  verifyCode(email: string, code: string): Promise<void>;
  /** Signed in but loading profiles failed: try that part again. */
  resume(): Promise<void>;
  continueAsGuest(): void;
  showSignIn(): void;
  cancelSignIn(): void;
  chooseProfile(profile: Profile): Promise<void>;
  /** Back to the profile screen, picking or straight into managing. */
  switchProfile(view?: "pick" | "manage"): void;
  profilesView: "pick" | "manage";
  createProfile(input: ProfileInput): Promise<Profile>;
  updateProfile(id: string, patch: Partial<ProfileInput>): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  signOut(): Promise<void>;
  deleteAccount(): Promise<void>;
}

const AccountContext = createContext<Account | null>(null);

const GUEST_KEY = "rustio.guest";
const LAST_PROFILE_KEY = "rustio.lastProfile";
const profilesKey = (userId: string) => `rustio.profiles.${userId}`;

function cachedProfiles(userId: string): Profile[] {
  try {
    return JSON.parse(localStorage.getItem(profilesKey(userId)) ?? "[]");
  } catch {
    return [];
  }
}

function defaultName(email: string) {
  const base = email.split("@")[0].replace(/[._-]+/g, " ").trim() || "Me";
  return (base[0].toUpperCase() + base.slice(1)).slice(0, 20);
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AccountStatus>(backend ? "loading" : "guest");
  const [user, setUser] = useState<AccountUser | null>(null);
  const [profiles, setProfilesState] = useState<Profile[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [canCancelSignIn, setCanCancel] = useState(false);
  const [profilesView, setProfilesView] = useState<"pick" | "manage">("pick");
  const statusRef = useRef(status);
  statusRef.current = status;

  const setProfiles = useCallback((userId: string, list: Profile[]) => {
    setProfilesState(list);
    localStorage.setItem(profilesKey(userId), JSON.stringify(list));
  }, []);

  const enter = useCallback(async (p: Profile) => {
    // Best effort: get the previous profile's last changes up first.
    await Promise.race([sync.flush(), new Promise((r) => setTimeout(r, 3000))]);
    await api.activateSpace(p.id);
    localStorage.setItem(LAST_PROFILE_KEY, p.id);
    setProfile(p);
    refreshLocalViews();
    setStatus("ready");
    void sync.start(p.id);
  }, []);

  /** After sign-in: load profiles (creating the first one), then pick one. */
  const afterSignIn = useCallback(
    async (u: AccountUser, { launch }: { launch: boolean }) => {
      if (!backend) return;
      setUser(u);
      localStorage.removeItem(GUEST_KEY);
      setCanCancel(false);
      let list: Profile[];
      try {
        list = await backend.profiles.list();
      } catch (e) {
        // Offline launch: carry on with the last known profiles.
        list = cachedProfiles(u.id);
        if (!list.length) throw e;
      }
      if (!list.length) {
        const first = await backend.profiles.create({ name: defaultName(u.email), avatar: nextAvatar([]), position: 0 });
        // Whatever was saved before signing up becomes this profile's.
        await api.importLocalInto(first.id);
        list = [first];
      }
      setProfiles(u.id, list);
      if (list.length === 1) return enter(list[0]);
      // Coming back to the app with one remembered profile: still ask, like
      // every streaming app, unless this is a mid-session re-sign-in.
      const last = list.find((p) => p.id === localStorage.getItem(LAST_PROFILE_KEY));
      if (!launch && last) return enter(last);
      setProfilesView("pick");
      setStatus("profiles");
    },
    [enter, setProfiles],
  );

  // Restore the session on launch.
  useEffect(() => {
    if (!backend) {
      void api.activateSpace(null).then(refreshLocalViews);
      return;
    }
    let cancelled = false;
    (async () => {
      const u = await backend.auth.current().catch(() => null);
      if (cancelled) return;
      if (u) {
        await afterSignIn(u, { launch: true }).catch(() => setStatus("signed-out"));
      } else {
        await api.activateSpace(null);
        setStatus(localStorage.getItem(GUEST_KEY) ? "guest" : "signed-out");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [afterSignIn]);

  // Session ended elsewhere (revoked, expired refresh token).
  useEffect(() => {
    if (!backend) return;
    return backend.auth.onChange((u) => {
      if (u || (statusRef.current !== "ready" && statusRef.current !== "profiles")) return;
      sync.stop();
      setUser(null);
      setProfile(null);
      void api.activateSpace(null).then(refreshLocalViews);
      setStatus("signed-out");
    });
  }, []);

  const value = useMemo<Account>(() => {
    const need = () => {
      if (!backend) throw new Error("Accounts aren't configured.");
      return backend;
    };
    const requireUser = () => {
      if (!user) throw new Error("Not signed in.");
      return user;
    };

    return {
      enabled: !!backend,
      status,
      user,
      profiles,
      profile,
      lastProfileId: localStorage.getItem(LAST_PROFILE_KEY),
      canCancelSignIn,

      async sendCode(email) {
        await need().auth.sendCode(email.trim().toLowerCase());
      },
      async verifyCode(email, code) {
        const u = await need().auth.verifyCode(email.trim().toLowerCase(), code.replace(/\s/g, ""));
        await afterSignIn(u, { launch: false });
      },
      async resume() {
        const u = await need().auth.current();
        if (!u) throw new Error("Your sign-in expired. Request a new code.");
        await afterSignIn(u, { launch: false });
      },
      continueAsGuest() {
        localStorage.setItem(GUEST_KEY, "1");
        void api.activateSpace(null).then(refreshLocalViews);
        setStatus("guest");
      },
      showSignIn() {
        setCanCancel(true);
        setStatus("signed-out");
      },
      cancelSignIn() {
        setCanCancel(false);
        setStatus("guest");
      },
      chooseProfile: enter,
      profilesView,
      switchProfile(view = "pick") {
        setProfilesView(view);
        void sync.finish();
        setStatus("profiles");
        // Refresh the list in the background (renamed on another device…).
        const u = user;
        if (u && backend) backend.profiles.list().then((l) => setProfiles(u.id, l), () => {});
      },
      async createProfile(input) {
        const u = requireUser();
        const created = await need().profiles.create({ ...input, position: profiles.length });
        setProfiles(u.id, [...profiles, created]);
        return created;
      },
      async updateProfile(id, patch) {
        const u = requireUser();
        const updated = await need().profiles.update(id, patch);
        setProfiles(u.id, profiles.map((p) => (p.id === id ? updated : p)));
        if (profile?.id === id) setProfile(updated);
      },
      async deleteProfile(id) {
        const u = requireUser();
        if (profiles.length <= 1) throw new Error("An account needs at least one profile.");
        await need().profiles.remove(id);
        await api.forgetSpace(id);
        setProfiles(u.id, profiles.filter((p) => p.id !== id));
        if (profile?.id === id) setProfile(null);
      },
      async signOut() {
        const b = need();
        // Get the last changes up before the local copies are dropped.
        await Promise.race([sync.flush(), new Promise((r) => setTimeout(r, 4000))]);
        sync.stop();
        await b.auth.signOut().catch(() => {});
        if (user) localStorage.removeItem(profilesKey(user.id));
        await api.forgetSpace(null);
        await api.activateSpace(null);
        refreshLocalViews();
        setUser(null);
        setProfile(null);
        setProfilesState([]);
        setCanCancel(false);
        setStatus("signed-out");
      },
      async deleteAccount() {
        const b = need();
        sync.stop();
        await b.auth.deleteAccount();
        if (user) localStorage.removeItem(profilesKey(user.id));
        await api.forgetSpace(null);
        await api.activateSpace(null);
        refreshLocalViews();
        setUser(null);
        setProfile(null);
        setProfilesState([]);
        setStatus("signed-out");
      },
    };
  }, [status, user, profiles, profile, canCancelSignIn, profilesView, afterSignIn, enter, setProfiles]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount outside AccountProvider");
  return ctx;
}
