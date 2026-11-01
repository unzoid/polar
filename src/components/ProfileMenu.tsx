import { Menu } from "@base-ui/react/menu";
import { Edit, Profile, SignOut } from "./icons";
import { useAccount } from "../lib/account/AccountProvider";
import { openSettings } from "../lib/settingsOverlay";
import { Avatar } from "./Avatar";

/** Navbar avatar: switch profile, manage profiles, account, sign out. */
export function ProfileMenu() {
  const account = useAccount();

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
                <span className="profile-menu-email">{account.user?.email}</span>
              </div>
            </div>
            {others.map((p) => (
              <Menu.Item key={p.id} className="profile-menu-item" onClick={() => void account.chooseProfile(p)}>
                <Avatar id={p.avatar} />
                {p.name}
              </Menu.Item>
            ))}
            <Menu.Item className="profile-menu-item" onClick={() => account.switchProfile("manage")}>
              <Edit />
              Manage Profiles
            </Menu.Item>
            <Menu.Item className="profile-menu-item" onClick={() => openSettings("account")}>
              <Profile />
              Account
            </Menu.Item>
            <div className="profile-menu-sep" />
            <Menu.Item className="profile-menu-item" onClick={() => void account.signOut()}>
              <SignOut />
              Sign Out
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
