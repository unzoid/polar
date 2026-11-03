import { Menu } from "@base-ui/react/menu";
import { Calendar, Edit, Profile, Settings, SignOut, WatchParty } from "./icons";
import { partyAvailable, setJoinPartyOpen } from "../lib/party/party";
import { useRouter } from "../lib/router";
import { useAccount } from "../lib/account/AccountProvider";
import { openSettings } from "../lib/settingsOverlay";
import { Avatar } from "./Avatar";

/** Used for the template profile when nobody's signed in. */
const GUEST_AVATAR = "guest";

/**
 * Navbar avatar, always there: Settings lives in its menu, for everyone.
 * Without an account it's a template "Guest" profile (Settings, Sign In);
 * signed in it adds switching profiles, managing them, the account and
 * signing out.
 */
export function ProfileMenu() {
  const account = useAccount();
  const signedIn = account.enabled && account.status !== "guest" && !!account.profile;
  const me = signedIn ? account.profile! : null;
  const others = me ? account.profiles.filter((p) => p.id !== me.id) : [];
  const name = me?.name ?? "Guest";
  const avatar = me?.avatar ?? GUEST_AVATAR;
  const { tab } = useRouter();

  return (
    <Menu.Root modal={false}>
      <Menu.Trigger className="navbar-profile pressable" aria-label={`Profile: ${name}`} title={name}>
        <Avatar id={avatar} />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner sideOffset={10} align="end" className="select-positioner">
          <Menu.Popup className="profile-menu">
            <div className="profile-menu-head">
              <Avatar id={avatar} />
              <div>
                <strong>{name}</strong>
                <span className="profile-menu-email">{me ? account.user?.email : "Not signed in"}</span>
              </div>
            </div>
            {others.map((p) => (
              <Menu.Item key={p.id} className="profile-menu-item" onClick={() => void account.chooseProfile(p)}>
                <Avatar id={p.avatar} />
                {p.name}
              </Menu.Item>
            ))}
            {me && (
              <Menu.Item className="profile-menu-item" onClick={() => account.switchProfile("manage")}>
                <Edit />
                Manage Profiles
              </Menu.Item>
            )}
            {others.length > 0 || me ? <div className="profile-menu-sep" /> : null}
            {me && partyAvailable() && (
              <Menu.Item className="profile-menu-item" onClick={() => setJoinPartyOpen(true)}>
                <WatchParty />
                Join Watch Party
              </Menu.Item>
            )}
            <Menu.Item className="profile-menu-item" onClick={() => tab({ name: "calendar" })}>
              <Calendar />
              Calendar
            </Menu.Item>
            <Menu.Item className="profile-menu-item" onClick={() => openSettings()}>
              <Settings />
              Settings
            </Menu.Item>
            {me && (
              <Menu.Item className="profile-menu-item" onClick={() => openSettings("account")}>
                <Profile />
                Account
              </Menu.Item>
            )}
            {account.enabled && <div className="profile-menu-sep" />}
            {me ? (
              <Menu.Item className="profile-menu-item" onClick={() => void account.signOut()}>
                <SignOut />
                Sign Out
              </Menu.Item>
            ) : (
              account.enabled && (
                <Menu.Item className="profile-menu-item" onClick={account.showSignIn}>
                  <Profile />
                  Sign In
                </Menu.Item>
              )
            )}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
