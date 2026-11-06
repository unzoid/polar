import { Calendar, Edit, Profile, Settings, SignOut, WatchParty } from "./icons";
import { partyAvailable, setJoinPartyOpen } from "../lib/party";
import { useRouter } from "../lib/router";
import { useAccount } from "../lib/account";
import { openSettings } from "../lib/settings";
import { useSettings } from "../lib/net";
import { Avatar } from "./Avatar";
import { MenuItem, MenuPopup, MenuRoot, MenuSeparator, MenuTrigger } from "./ui/Menu";

/** Used for the template profile when nobody's signed in. */
const GUEST_AVATAR = "guest";

/**
 * Navbar avatar, always there: Settings lives in its menu, for everyone, and
 * the Calendar while it isn't a navbar tab.
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
  // While Settings → Browsing → Show the Calendar makes it a navbar tab, it isn't listed here too (#92).
  const { data: settings } = useSettings();

  return (
    <MenuRoot modal={false}>
      <MenuTrigger className="navbar-profile pressable" aria-label={`Profile: ${name}`} title={name}>
        <Avatar id={avatar} />
      </MenuTrigger>
      <MenuPopup look="roomy" sideOffset={10} align="end">
        <div className="profile-menu-head">
          <Avatar id={avatar} />
          <div>
            <strong>{name}</strong>
            {me ? <span className="profile-menu-email">{account.user?.email}</span> : <span>Not signed in</span>}
          </div>
        </div>
        {others.map((p) => (
          <MenuItem key={p.id} icon={<Avatar id={p.avatar} />} onClick={() => void account.chooseProfile(p)}>
            {p.name}
          </MenuItem>
        ))}
        {me && (
          <MenuItem icon={<Edit />} onClick={() => account.switchProfile("manage")}>
            Manage Profiles
          </MenuItem>
        )}
        {others.length > 0 || me ? <MenuSeparator /> : null}
        {me && partyAvailable() && (
          <MenuItem icon={<WatchParty />} onClick={() => setJoinPartyOpen(true)}>
            Join Watch Party
          </MenuItem>
        )}
        {!settings?.showCalendar && (
          <MenuItem icon={<Calendar />} onClick={() => tab({ name: "calendar" })}>
            Calendar
          </MenuItem>
        )}
        <MenuItem icon={<Settings />} onClick={() => openSettings()}>
          Settings
        </MenuItem>
        {me && (
          <MenuItem icon={<Profile />} onClick={() => openSettings("account")}>
            Account
          </MenuItem>
        )}
        {account.enabled && <MenuSeparator />}
        {me ? (
          <MenuItem icon={<SignOut />} onClick={() => void account.signOut()}>
            Sign Out
          </MenuItem>
        ) : (
          account.enabled && (
            <MenuItem icon={<Profile />} onClick={account.showSignIn}>
              Sign In
            </MenuItem>
          )
        )}
      </MenuPopup>
    </MenuRoot>
  );
}
