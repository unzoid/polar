/**
 * A pretend account for trying the signed-in experience without a server:
 * profiles live in localStorage and sync is a no-op (each profile's library
 * and progress still save locally, like any profile). Turned on from the
 * sign-in screen; signing out of it turns it off again.
 */
import { AccountError, type AccountBackend, type AccountUser, type Profile } from "./backend";
import { normalizeAvatar } from "./avatars";

export const DEMO_FLAG = "rustio.demo";
const PROFILES_KEY = "rustio.demo.profiles";
const MAX_PROFILES = 5;
const USER: AccountUser = { id: "demo-user", email: "demo@rustio.app" };

export const isDemo = () => localStorage.getItem(DEMO_FLAG) === "1";

/** Switch to the demo account (or back) and restart the app on it. */
export function setDemo(on: boolean) {
  // Every demo starts from the same three profiles.
  localStorage.removeItem(PROFILES_KEY);
  if (on) localStorage.setItem(DEMO_FLAG, "1");
  else localStorage.removeItem(DEMO_FLAG);
  location.reload();
}

/**
 * A household to start with, so the demo opens on "Who's watching?" (with a
 * single profile the app skips straight past it). Each gets its own library.
 */
const STARTERS: Profile[] = [
  { id: "demo-you", name: "You", avatar: "blue", position: 0 },
  { id: "demo-sam", name: "Sam", avatar: "fox", position: 1 },
  { id: "demo-kids", name: "Kids", avatar: "cat", position: 2 },
];

function load(): Profile[] {
  const saved = localStorage.getItem(PROFILES_KEY);
  if (saved === null) return STARTERS;
  try {
    return (JSON.parse(saved) as Profile[]).map((p) => ({
      ...p,
      avatar: normalizeAvatar(p.avatar),
    }));
  } catch {
    return [];
  }
}
const store = (list: Profile[]) => localStorage.setItem(PROFILES_KEY, JSON.stringify(list));

/** Feels like a network round trip, so loading states show up. */
const delay = () => new Promise((r) => setTimeout(r, 250));

export function createDemoBackend(): AccountBackend {
  return {
    name: "demo",

    auth: {
      async current() {
        return USER;
      },
      onChange() {
        return () => {};
      },
      async sendCode() {},
      async verifyCode() {
        return USER;
      },
      async signOut() {
        setDemo(false);
      },
      async deleteAccount() {
        localStorage.removeItem(PROFILES_KEY);
        setDemo(false);
      },
    },

    profiles: {
      async list() {
        await delay();
        return load().sort((a, b) => a.position - b.position);
      },
      async create(input) {
        await delay();
        const list = load();
        if (list.length >= MAX_PROFILES) {
          throw new AccountError("profile_limit", "An account can have up to 5 profiles.");
        }
        const created: Profile = { id: `demo-${crypto.randomUUID()}`, ...input };
        store([...list, created]);
        return created;
      },
      async update(id, patch) {
        await delay();
        const list = load();
        const current = list.find((p) => p.id === id);
        if (!current) throw new AccountError("unknown", "That profile no longer exists.");
        const updated = { ...current, ...patch };
        store(list.map((p) => (p.id === id ? updated : p)));
        return updated;
      },
      async remove(id) {
        await delay();
        store(load().filter((p) => p.id !== id));
      },
    },

    sync: {
      async pull(_profileId, cursor) {
        return { library: [], progress: [], cursor };
      },
      async push() {},
    },
  };
}
