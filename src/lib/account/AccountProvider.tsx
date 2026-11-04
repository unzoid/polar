import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api } from "../api";
import { listOf, storedJson } from "../parse";
import { warnFailed } from "../errors";
import { readProfile } from "./backend";
import { backend, type AccountUser, type Profile, type ProfileInput } from "./index";
import { forgetPlaylists, importLocalPlaylists } from "../playlists";
import { clearRecentSearches } from "../recentSearches";
import { forgetSettings, keepDeviceSettings, markDeviceSettings, restoreDeviceSettings, restoreSettings } from "./settingsSync";
import { forgetLinksUnsent, refreshLocalViews, sync } from "./sync";

/**
 *  - loading:    restoring the session
 *  - signed-out: show the sign-in screen
 *  - guest:      using Polar without an account (local library only)
 *  - onboarding: new account, naming and picking an icon for the first profile
 *  - profiles:   signed in, "Who's watching?"
 *  - ready:      signed in with a profile; the app is showing
 */
export type AccountStatus = "loading" | "signed-out" | "guest" | "onboarding" | "profiles" | "ready";

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
  /** Onboarding: create the account's first profile and go straight in. */
  createFirstProfile(input: ProfileInput): Promise<void>;
  updateProfile(id: string, patch: Partial<ProfileInput>): Promise<void>;
  deleteProfile(id: string): Promise<void>;
  /**
   * Pushes every profile's changes first. When some still haven't reached the account (offline,
   * a server error), nothing is dropped: `signOutBlocked` says how many, and the sign-out dialog
   * asks; `{ discard: true }` signs out anyway.
   */
  signOut(opts?: { discard?: boolean }): Promise<void>;
  /** Changes that would be lost by signing out now; set by a `signOut()` that stopped to ask. */
  signOutBlocked: number | null;
  cancelSignOut(): void;
  deleteAccount(): Promise<void>;
}

const AccountContext = createContext<Account | null>(null);

/** How long sign-out waits for the pushes before it counts what's left. */
const SIGN_OUT_PUSH_MS = 8000;

const GUEST_KEY = "polar.guest";
const LAST_PROFILE_KEY = "polar.lastProfile";
const profilesKey = (userId: string) => `polar.profiles.${userId}`;

const cachedProfiles = (userId: string): Profile[] => listOf(storedJson(localStorage, profilesKey(userId)), readProfile);

export function AccountProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AccountStatus>(backend ? "loading" : "guest");
  const [user, setUser] = useState<AccountUser | null>(null);
  const [profiles, setProfilesState] = useState<Profile[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [canCancelSignIn, setCanCancel] = useState(false);
  const [profilesView, setProfilesView] = useState<"pick" | "manage">("pick");
  const [signOutBlocked, setSignOutBlocked] = useState<number | null>(null);
  const statusRef = useRef(status);
  statusRef.current = status;

  const setProfiles = useCallback((userId: string, list: Profile[]) => {
    setProfilesState(list);
    sync.setProfiles(list.map((p) => p.id));
    localStorage.setItem(profilesKey(userId), JSON.stringify(list));
  }, []);

  const enter = useCallback(async (p: Profile) => {
    // Best effort: get the previous profile's last changes up first. Whatever doesn't make it
    // goes up in the background with the next profile's sync rounds.
    await Promise.race([sync.flush(), new Promise((r) => setTimeout(r, 3000))]);
    await api.activateSpace(p.id);
    await keepDeviceSettings(p.id).catch(warnFailed("Keeping this device's settings"));
    // This profile's settings as this device last synced them; reinstalling
    // addons can take a moment, so don't hold the app for it.
    await Promise.race([restoreSettings(p.id).catch(warnFailed("Restoring the profile's settings")), new Promise((r) => setTimeout(r, 1500))]);
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
      setProfiles(u.id, list);
      // New account: name the first profile and pick its icon.
      if (!list.length) return setStatus("onboarding");
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
        markDeviceSettings();
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
      if (u || !["ready", "profiles", "onboarding"].includes(statusRef.current)) return;
      sync.stop();
      sync.setProfiles([]);
      setUser(null);
      setProfile(null);
      void api
        .activateSpace(null)
        .then(() => restoreDeviceSettings().catch(warnFailed("Restoring this device's settings")))
        .then(refreshLocalViews);
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
    /** What this device keeps of one profile, besides its library and history in the Rust store. */
    const forgetProfile = (id: string) => {
      forgetSettings(id);
      forgetPlaylists(id);
      forgetLinksUnsent(id);
    };
    /**
     * Sign-out, deleted account: nothing of the account stays on the device (critique M12), and
     * the settings go back to what they were before a profile was entered.
     */
    const forgetLocal = async () => {
      if (user) localStorage.removeItem(profilesKey(user.id));
      localStorage.removeItem(LAST_PROFILE_KEY);
      profiles.forEach((p) => forgetProfile(p.id));
      clearRecentSearches();
      await api.forgetSpace(null);
      await api.activateSpace(null);
      await restoreDeviceSettings().catch(warnFailed("Restoring this device's settings"));
      refreshLocalViews();
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
      async createFirstProfile(input) {
        const u = requireUser();
        const first = await need().profiles.create({ ...input, position: 0 });
        // Whatever was saved before signing up becomes this profile's.
        await api.importLocalInto(first.id);
        importLocalPlaylists(first.id);
        setProfiles(u.id, [first]);
        await enter(first);
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
        forgetProfile(id);
        setProfiles(u.id, profiles.filter((p) => p.id !== id));
        if (profile?.id === id) setProfile(null);
      },
      signOutBlocked,
      cancelSignOut: () => setSignOutBlocked(null),
      async signOut(opts) {
        const b = need();
        // Every profile's copy is dropped below: get all their changes up first (critique C2).
        if (!opts?.discard) {
          const left = await sync.pushEverything(profiles.map((p) => p.id), SIGN_OUT_PUSH_MS);
          if (left > 0) return setSignOutBlocked(left);
        }
        setSignOutBlocked(null);
        sync.stop();
        sync.setProfiles([]);
        await b.auth.signOut().catch(warnFailed("Signing out on the server"));
        await forgetLocal();
        setUser(null);
        setProfile(null);
        setProfilesState([]);
        setCanCancel(false);
        setStatus("signed-out");
      },
      async deleteAccount() {
        const b = need();
        sync.stop();
        sync.setProfiles([]);
        await b.auth.deleteAccount();
        await forgetLocal();
        setUser(null);
        setProfile(null);
        setProfilesState([]);
        setStatus("signed-out");
      },
    };
  }, [status, user, profiles, profile, canCancelSignIn, profilesView, signOutBlocked, afterSignIn, enter, setProfiles]);

  return <AccountContext.Provider value={value}>{children}</AccountContext.Provider>;
}

export function useAccount() {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount outside AccountProvider");
  return ctx;
}
