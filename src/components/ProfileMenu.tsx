import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Calendar, ChevronLeft, ChevronRight, Edit, OpenFile, Profile, Settings, SignOut, Users, WatchParty } from "./icons";
import { canOpenFiles, setOpenFilesOpen } from "../lib/localFiles";
import { closePartySurface, getParty, leaveParty, partyAvailable, setJoinPartyOpen, usePartySurface } from "../lib/party";
import { friendsAvailable, setFriendsOpen, useFriends } from "../lib/friends";
import { useRouter } from "../lib/router";
import { useAccount } from "../lib/account";
import { openSettings, useSettingsOverlay } from "../lib/settings";
import { FriendsBody } from "./friends/FriendsPanel";
import { JoinForm, LinkForm } from "./party/PartyUI";
import { useSettings } from "../lib/net";
import { useFormFactor } from "../lib/ui";
import { Avatar } from "./Avatar";
import { Sheet } from "./Sheet";
import { MenuItem, MenuPopup, MenuRoot, MenuSeparator, MenuTrigger } from "./ui/Menu";
import { anchorOf, nativeDialogsAvailable, showNativeDialog, type DialogAction } from "../lib/platform";
import { warnFailed } from "../lib/errors";

/** Used for the template profile when nobody's signed in. */
const GUEST_AVATAR = "guest";

/** `stay`: on a phone the profile sheet stays open (Friends and Join open as views inside it, Settings over it). */
type Choice = { id: string; label: string; icon: ReactNode; run: () => void; stay?: boolean };

/**
 * Navbar avatar, always there: Settings lives in its menu, for everyone, and
 * the Calendar while it isn't a navbar tab.
 * Without an account it's a template "Guest" profile (Settings, Sign In);
 * signed in it adds switching profiles, managing them, the account and
 * signing out. The same choices three ways: a menu under the avatar, a sheet
 * from the bottom edge on a phone (in reach of a thumb), and on iOS the
 * system's own menu.
 */
export function ProfileMenu() {
  const account = useAccount();
  const phone = useFormFactor().form === "phone";
  const signedIn = account.enabled && account.status !== "guest" && !!account.profile;
  const me = signedIn ? account.profile! : null;
  const others = me ? account.profiles.filter((p) => p.id !== me.id) : [];
  const name = me?.name ?? "Guest";
  const avatar = me?.avatar ?? GUEST_AVATAR;
  const { tab } = useRouter();
  // While Settings → Browsing → Show the Calendar makes it a navbar tab, it isn't listed here too (#92).
  const { data: settings } = useSettings();
  // Requests waiting for an answer show on the Friends item (#135).
  const { entries } = useFriends();
  const requests = entries.filter((e) => e.state === "pending" && e.incoming).length;

  const profiles: Choice[] = others.map((p) => ({ id: `profile:${p.id}`, label: p.name, icon: <Avatar id={p.avatar} />, run: () => void account.chooseProfile(p) }));
  const manage: Choice[] = me ? [{ id: "manage", label: "Manage Profiles", icon: <Edit />, run: () => account.switchProfile("manage") }] : [];
  const actions: Choice[] = [
    ...(me && partyAvailable() ? [{ id: "party", label: "Join Watch Party", icon: <WatchParty />, run: () => setJoinPartyOpen(true), stay: true }] : []),
    ...(me && friendsAvailable()
      ? [{ id: "friends", label: requests ? `Friends (${requests})` : "Friends", icon: <Users />, run: () => setFriendsOpen(true), stay: true }]
      : []),
    ...(canOpenFiles ? [{ id: "open-file", label: "Open File…", icon: <OpenFile />, run: () => setOpenFilesOpen(true) }] : []),
    ...(!settings?.showCalendar ? [{ id: "calendar", label: "Calendar", icon: <Calendar />, run: () => tab({ name: "calendar" }) }] : []),
    { id: "settings", label: "Settings", icon: <Settings />, run: () => openSettings(), stay: true },
    ...(me ? [{ id: "account", label: "Account", icon: <Profile />, run: () => openSettings("account"), stay: true }] : []),
  ];
  const session: Choice[] = me
    ? [{ id: "sign-out", label: "Sign Out", icon: <SignOut />, run: () => void account.signOut() }]
    : account.enabled
      ? [{ id: "sign-in", label: "Sign In", icon: <Profile />, run: account.showSignIn }]
      : [];

  if (nativeDialogsAvailable) {
    // The web menu below, as groups of choices (a separator between groups).
    const groups = [[...profiles, ...manage], actions, session];
    const choices = groups.flat();
    const open = (el: HTMLElement) => {
      const list = groups.flatMap((g, i) => g.map((c): DialogAction => ({ id: c.id, label: c.label, style: "default", group: i })));
      showNativeDialog({ kind: "menu", title: me ? name : `${name} · Not signed in`, anchor: anchorOf(el), actions: list })
        .then((picked) => choices.find((c) => c.id === picked)?.run())
        .catch(warnFailed("profile menu"));
    };
    return (
      <button type="button" className="navbar-profile pressable" aria-label={`Profile: ${name}`} aria-haspopup="menu" onClick={(e) => open(e.currentTarget)}>
        <Avatar id={avatar} />
      </button>
    );
  }

  if (phone)
    return (
      <ProfileSheet
        name={name}
        avatar={avatar}
        me={me}
        email={me ? account.user?.email : undefined}
        profiles={profiles}
        manage={manage[0]}
        groups={[actions, session]}
      />
    );

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
        {[...profiles, ...manage].map((c) => (
          <MenuItem key={c.id} icon={c.icon} onClick={c.run}>
            {c.label}
          </MenuItem>
        ))}
        {others.length > 0 || me ? <MenuSeparator /> : null}
        {actions.map((c) => (
          <MenuItem key={c.id} icon={c.icon} onClick={c.run}>
            {c.label}
          </MenuItem>
        ))}
        {session.length > 0 && <MenuSeparator />}
        {session.map((c) => (
          <MenuItem key={c.id} icon={c.icon} onClick={c.run}>
            {c.label}
          </MenuItem>
        ))}
      </MenuPopup>
    </MenuRoot>
  );
}

/**
 * On a phone: a sheet from the bottom edge. Who's watching first (the profile, then the others to switch to, a
 * tap each), then the rest as rows in cards. Friends and Join Watch Party open as views inside it, with a Back to
 * the list; the sheet's height follows the view. Settings and Account rise over it, and close back to it. Any
 * other choice closes it as it runs.
 *
 * The views are the party surfaces' (lib/party/surface.ts): opened from anywhere else (a friend's request, a
 * notice), the sheet comes up at that view, and the player coming up closes them as it closes the dialogs.
 */
function ProfileSheet({
  name,
  avatar,
  me,
  email,
  profiles,
  manage,
  groups,
}: {
  name: string;
  avatar: string;
  me: { name: string; avatar: string } | null;
  email?: string;
  profiles: Choice[];
  manage?: Choice;
  groups: Choice[][];
}) {
  const [listed, setListed] = useState(false);
  const surface = usePartySurface();
  const view: "list" | "friends" | "join" = surface === "friends" ? "friends" : surface === "join" && me ? "join" : "list";
  const open = listed || view !== "list";
  // Only a change of view inside the open sheet slides; on opening the sheet's own rise is the entrance.
  const [seen, setSeen] = useState({ open, view, slide: false });
  const slide = seen.open === open && seen.view === view ? seen.slide : seen.open && open && seen.view !== view;
  if (seen.open !== open || seen.view !== view) setSeen({ open, view, slide });
  const { current } = useRouter();
  useEffect(() => {
    if (current.name === "player") setListed(false);
  }, [current.name]);

  // Settings over the sheet takes Escape and Back first: they close it, not the sheet under it. Read from the last
  // render, so the Escape that closes Settings doesn't see it closed already and close the sheet too.
  const settingsOpen = useSettingsOverlay().open;
  const covered = useRef(settingsOpen);
  useEffect(() => {
    covered.current = settingsOpen;
  }, [settingsOpen]);

  const leaveView = () => {
    // Closed while waiting for a friend's host: that's giving up on joining.
    if (getParty()?.knocking) leaveParty();
    closePartySurface("friends");
    closePartySurface("join");
  };
  const close = () => {
    if (covered.current) return;
    leaveView();
    setListed(false);
  };
  const back = () => {
    leaveView();
    setListed(true);
  };
  const done = () => {
    closePartySurface("friends");
    closePartySurface("join");
    setListed(false);
  };
  const pick = (c: Choice) => {
    setListed(!!c.stay);
    c.run();
  };

  const title =
    view === "list" ? (
      "Profiles"
    ) : (
      <span className="profile-sheet-title">
        <button className="profile-sheet-back pressable" aria-label="Back" onPointerDown={(e) => e.stopPropagation()} onClick={back}>
          <ChevronLeft size={22} strokeWidth={2.25} />
        </button>
        {view === "friends" ? "Friends" : "Join a Watch Party"}
      </span>
    );

  return (
    <>
      <button type="button" className="navbar-profile pressable" aria-label={`Profile: ${name}`} aria-haspopup="dialog" onClick={() => setListed(true)}>
        <Avatar id={avatar} />
      </button>
      <Sheet open={open} onClose={close} title={title}>
        <FitHeight>
          <div key={view} className="profile-sheet" data-view={view} data-slide={slide || undefined}>
            {view === "friends" && <FriendsBody inDialog={false} />}
            {view === "join" && me && (
              <div className="profile-sheet-join">
                <p className="party-dialog-text">Enter the code a friend shared with you.</p>
                <JoinForm me={me} onJoined={done} />
                <div className="party-or" aria-hidden>
                  <span>or watch a link together</span>
                </div>
                <LinkForm me={me} onDone={done} />
              </div>
            )}
            {view === "list" && (
              <ProfileList name={name} avatar={avatar} email={email} profiles={profiles} manage={manage} groups={groups} pick={pick} />
            )}
          </div>
        </FitHeight>
      </Sheet>
    </>
  );
}

/** Its content's height, changing with it: the sheet grows and shrinks between views instead of jumping. */
function FitHeight({ children }: { children: ReactNode }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number>();
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div className="fit-height" style={{ height }}>
      <div ref={inner}>{children}</div>
    </div>
  );
}

function ProfileList({
  name,
  avatar,
  email,
  profiles,
  manage,
  groups,
  pick,
}: {
  name: string;
  avatar: string;
  email?: string;
  profiles: Choice[];
  manage?: Choice;
  groups: Choice[][];
  pick: (c: Choice) => void;
}) {
  return (
    <>
      <div className="profile-sheet-me">
            <Avatar id={avatar} />
            <strong>{name}</strong>
            <span>{email ?? "Not signed in"}</span>
          </div>
          {(profiles.length > 0 || manage) && (
            <div className="profile-sheet-others">
              {profiles.map((c) => (
                <button key={c.id} className="profile-sheet-other pressable" onClick={() => pick(c)}>
                  {c.icon}
                  <span>{c.label}</span>
                </button>
              ))}
              {manage && (
                <button className="profile-sheet-other pressable" onClick={() => pick(manage)}>
                  <span className="profile-sheet-manage" aria-hidden>
                    <Edit size={22} />
                  </span>
                  <span>Manage</span>
                </button>
              )}
            </div>
          )}
          {groups
            .filter((g) => g.length)
            .map((g) => (
              <div key={g[0].id} className="profile-sheet-card">
                {g.map((c) => (
                  <button key={c.id} className="profile-sheet-row" onClick={() => pick(c)}>
                    {c.icon}
                    <span>{c.label}</span>
                    <ChevronRight size={18} aria-hidden />
                  </button>
                ))}
              </div>
            ))}
    </>
  );
}
