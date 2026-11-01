import { Menu } from "@base-ui/react/menu";
import { LogOut, Pencil, RefreshCw, UserRound } from "lucide-react";
import { useAccount } from "../lib/account/AccountProvider";
import { isDemo } from "../lib/account/demo";
import { sync, useSyncStatus } from "../lib/account/sync";
import { useRouter } from "../lib/router";
import { Avatar } from "./Avatar";

/** Navbar avatar: switch profile, manage profiles, account, sign out. */
export function ProfileMenu() {
  const account = useAccount();
  const { tab } = useRouter();

  if (!account.enabled) return null;
  if (account.status === "guest") {
    return (
      <button className="navbar-signin pressable" onClick={account.showSignIn}>
        Sign In
      </button>
    );
  }
  const me = account.profile;
  if (!me) return null;
  const others = account.profiles.filter((p) => p.id !== me.id);

  return (
    <Menu.Root modal={false}>
      <Menu.Trigger className="navbar-profile pressable" aria-label={`Profile: ${me.name}`} title={me.name}>
        <Avatar id={me.avatar} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={10} align="end" className="select-positioner">
          <Menu.Popup className="profile-menu">
            <div className="profile-menu-head">
              <Avatar id={me.avatar} />
              <div>
                <strong>{me.name}</strong>
                <span>{account.user?.email}</span>
              </div>
            </div>
            {others.map((p) => (
              <Menu.Item key={p.id} className="profile-menu-item" onClick={() => void account.chooseProfile(p)}>
                <Avatar id={p.avatar} />
                {p.name}
              </Menu.Item>
            ))}
            <Menu.Item className="profile-menu-item" onClick={() => account.switchProfile("manage")}>
              <Pencil />
              Manage Profiles
            </Menu.Item>
            <Menu.Item className="profile-menu-item" onClick={() => tab({ name: "settings", page: "account" })}>
              <UserRound />
              Account
            </Menu.Item>
            <Menu.Item className="profile-menu-item" closeOnClick={false} onClick={() => void sync.now()}>
              <RefreshCw />
              Sync Now
            </Menu.Item>
            <SyncLine />
            <div className="profile-menu-sep" />
            <Menu.Item className="profile-menu-item" onClick={() => void account.signOut()}>
              <LogOut />
              {isDemo() ? "Exit Demo" : "Sign Out"}
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function SyncLine() {
  const s = useSyncStatus();
  const text =
    s.state === "syncing"
      ? "Syncing…"
      : s.state === "error"
        ? `Couldn't sync: ${s.error}`
        : s.lastSyncedAt
          ? `Synced ${new Date(s.lastSyncedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
          : null;
  if (!text) return null;
  return (
    <p className="profile-menu-sync" data-state={s.state}>
      {text}
    </p>
  );
}
