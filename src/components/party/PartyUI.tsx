import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ease } from "../../lib/ui";
import { anchorOf, nativeDialogsAvailable, shareNatively } from "../../lib/platform";
import { warnFailed } from "../../lib/errors";
import {
  admit,
  behind,
  CODE_LENGTH,
  checkLink,
  deny,
  getParty,
  isStreamLink,
  joinParty,
  kick,
  leaveParty,
  linkMedia,
  makeHost,
  memberStatus,
  normalizeCode,
  partyAct,
  startParty,
  useParty,
  type Member,
  type PartyState,
} from "../../lib/party";
import { api } from "../../lib/api";
import { Avatar } from "../Avatar";
import { BusyLabel } from "../BusyLabel";
import { Spinner } from "../Spinner";
import { Check, Minus, More, Star, WatchParty } from "../icons";
import { Button, iconButtonClass } from "../ui/Button";
import { MenuItem, MenuPopup, MenuRoot, MenuTrigger } from "../ui/Menu";

type Me = Pick<Member, "name" | "avatar">;

/** Not in a party: start one on what's playing, or join a friend's. */
/** Without `onStart` (a file on this device, #204) a party can't start here, and it says why. */
export function PartyStart({ onStart, me }: { onStart?: () => void; me: Me }) {
  return (
    <div className="party-pane">
      {onStart ? (
        <>
          <p className="party-lede">
            Watch in sync with friends. Everyone plays from their own sources; pausing, seeking and changing episodes
            happen for the whole room.
          </p>
          <Button variant="primary" className="party-start" onClick={onStart}>
            <WatchParty size={18} /> Start a Watch Party
          </Button>
        </>
      ) : (
        <p className="party-lede">
          This file is on your device, so it can't be shared with a watch party. A party could only follow along if
          everyone opened the same file on their own device.
        </p>
      )}
      <div className="party-or" aria-hidden>
        <span>or join one</span>
      </div>
      <JoinForm me={me} />
    </div>
  );
}

/** What the readiness check says of a web page (crates/addon probe.rs). */
const PAGE = "Answered with a page, not a video";

/**
 * Puts a link on for the whole party (#136), or opens a party on it: once it's a web link that answers
 * with a video. Video pages (a site's page around its player) aren't played: the player opens files and
 * HLS/DASH streams only. PartyHost then opens it here, and asks everyone else first.
 */
export function useWatchLink(me: Me, onDone?: () => void) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  // Set again on every mount: StrictMode mounts twice, and a first unmount mustn't leave the form deaf.
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const submit = () => {
    if (busy) return;
    const link = checkLink(text);
    if (!link.ok) return setError(link.reason);
    setBusy(true);
    setError(null);
    const play = () => {
      const media = linkMedia(link.url);
      if (getParty()?.playback) partyAct({ media, position: 0, paused: false });
      else startParty(media, 0, false, me);
      setText("");
      onDone?.();
    };
    api.streamReady(link.url).then(
      (r) => {
        if (!alive.current) return;
        setBusy(false);
        // A stream's manifest may come as plain text; the player reads it all the same.
        if (r.state !== "notReady" || (r.reason === PAGE && isStreamLink(link.url))) return play();
        setError(
          r.reason === PAGE
            ? "That's a web page, not a video. Paste the address of the video file or stream itself (.mp4, .mkv, .m3u8, .mpd…)."
            : `That link didn't play: ${r.reason}.`,
        );
      },
      (e: Error) => {
        if (!alive.current) return;
        setBusy(false);
        setError(`That link couldn't be checked: ${e.message}`);
      },
    );
  };
  const change = (value: string) => {
    setText(value);
    setError(null);
  };
  return { text, change, submit, busy, error };
}

/** "Watch a Link": paste a video's address, and everyone in the party watches it (#136). */
export function LinkForm({ me, onDone }: { me: Me; onDone?: () => void }) {
  const { text, change, submit, busy, error } = useWatchLink(me, onDone);
  return (
    <form
      className="party-join party-link"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        className="party-join-input"
        aria-label="Video link"
        placeholder="https://… (video file or stream)"
        type="url"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        value={text}
        data-invalid={!!error}
        onChange={(e) => change(e.target.value)}
      />
      <Button variant="glass" className="party-join-btn" type="submit" disabled={busy || !text.trim()} aria-busy={busy}>
        <BusyLabel busy={busy}>Watch</BusyLabel>
      </Button>
      <p className="party-join-error" role="alert" data-shown={!!error}>
        {error}
      </p>
    </form>
  );
}

/** In a party: the code to share, and leaving (unless the menu has its own Leave); `autoFocus` focuses sharing it. */
export function PartyInvite({ party, leave = true, autoFocus }: { party: PartyState; leave?: boolean; autoFocus?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const invite = `Watch with me on Polarity. Party code: ${party.code}`;
  const copy = () => {
    void navigator.clipboard.writeText(invite).then(() => {
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <div className="party-pane party-swap">
      <span className="party-kicker">Party code</span>
      <div className="party-code tabular" aria-label={`Party code ${party.code.split("").join(" ")}`}>
        {party.code.split("").map((c, i) => (
          <span key={i}>{c}</span>
        ))}
      </div>
      <p className="party-lede">
        {party.error
          ? party.error
          : party.status === "error"
          ? "Connection lost. Reconnecting…"
          : party.status === "connecting"
            ? "Opening the room…"
            : "Friends join from their profile menu with this code."}
      </p>
      <div className="party-buttons">
        {/* In the menu, going back to the stream is the main action. */}
        {nativeDialogsAvailable ? (
          // iOS: the share sheet, which copies too.
          <Button
            variant={leave ? "primary" : "glass"}
            autoFocus={autoFocus}
            onClick={(e) => void shareNatively({ text: invite, anchor: anchorOf(e.currentTarget) }).catch(warnFailed("share sheet"))}
          >
            Share Invite
          </Button>
        ) : (
          <Button variant={leave ? "primary" : "glass"} className="party-copy" onClick={copy} data-copied={copied} autoFocus={autoFocus}>
            <span className="party-copy-label" data-shown={!copied}>
              Copy Invite
            </span>
            <span className="party-copy-label" data-shown={copied} aria-hidden={!copied}>
              <Check size={16} /> Copied
            </span>
          </Button>
        )}
        {leave && (
          <Button variant="glass" onClick={leaveParty}>
            Leave Party
          </Button>
        )}
      </div>
    </div>
  );
}

/** "Watching · 4 s behind": the status, and how far behind the room when it's worth saying. */
function memberDetail(party: PartyState, m: Member) {
  const status = memberStatus(m, party.playback);
  const late = m.id !== party.me && (status === "Watching" || status === "Buffering") ? behind(m.id) : undefined;
  const text = late ? `${status} · ${Math.round(late)} s behind` : status;
  return m.id === party.hostId ? `Host · ${text}` : text;
}

/**
 * Who's here, and what each is doing: the same words on every screen. The
 * host can hand the role over or remove someone from each row, and let in
 * (or turn away) anyone waiting to join.
 */
export function PartyMembers({ party }: { party: PartyState }) {
  const statusOf = (m: Member) => memberStatus(m, party.playback);
  const host = party.hostId === party.me;
  return (
    <>
      {host && party.knockers.length > 0 && (
        <ul className="party-members party-knockers" aria-label="Waiting to join">
          {party.knockers.map((m) => (
            <li key={m.id} className="party-member">
              <Avatar id={m.avatar} />
              <span className="party-member-text">
                <span className="party-member-name">{m.name}</span>
                <span className="party-member-detail">Wants to join</span>
              </span>
              <span className="party-member-actions">
                <Button variant="primary" className="party-mini" onClick={() => admit(m.id)}>
                  Let In
                </Button>
                <Button variant="glass" className="party-mini" onClick={() => deny(m.id)} aria-label={`Don't let ${m.name} in`}>
                  Decline
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
      <PartyMemberList party={party} host={host} statusOf={statusOf} />
    </>
  );
}

function PartyMemberList({ party, host, statusOf }: { party: PartyState; host: boolean; statusOf: (m: Member) => string }) {
  return (
    <ul className="party-members party-swap">
      <AnimatePresence initial={false} mode="popLayout">
        {party.members.map((m) => (
          <motion.li
            key={m.id}
            layout="position"
            className="party-member"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.15, ease: ease.out } }}
            transition={{ duration: 0.22, ease: ease.out }}
          >
            <Avatar id={m.avatar} />
            <span className="party-member-text">
              <span className="party-member-name">
                {m.name}
                {m.id === party.me && <span className="muted"> (You)</span>}
              </span>
              <span className="party-member-detail" data-lost={m.lost || undefined}>
                {memberDetail(party, m)}
              </span>
            </span>
            {(m.waiting || m.buffering) && !m.away && !m.lost && <Spinner size={16} label={statusOf(m)} />}
            {host && m.id !== party.me && (
              <MenuRoot>
                <MenuTrigger className={iconButtonClass("plain", "party-member-more")} aria-label={`${m.name}: host actions`}>
                  <More size={20} />
                </MenuTrigger>
                <MenuPopup align="end" aria-label={m.name}>
                  {!m.lost && (
                    <MenuItem icon={<Star size={16} />} onClick={() => makeHost(m.id)}>
                      Make Host
                    </MenuItem>
                  )}
                  <MenuItem icon={<Minus size={16} />} onClick={() => kick(m.id)}>
                    Remove from Party
                  </MenuItem>
                </MenuPopup>
              </MenuRoot>
            )}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

/**
 * Entering a party code, for the desktop field and TV mode's on-screen
 * keyboard alike: normalised as typed, and joined as soon as it's complete.
 */
export function useJoinParty(me: Me, onJoined?: () => void) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (value = code) => {
    if (busy) return;
    if (value.length < CODE_LENGTH) return setError("Party codes are 6 letters and numbers.");
    setBusy(true);
    setError(null);
    joinParty(value, me).then(
      () => {
        setBusy(false);
        onJoined?.();
      },
      (e: Error) => {
        setBusy(false);
        setError(e.message);
      },
    );
  };
  const change = (text: string) => {
    const v = normalizeCode(text);
    setCode(v);
    setError(null);
    // Typed or pasted in full: no need to press anything.
    if (v.length === CODE_LENGTH && v !== code) submit(v);
  };
  return { code, change, submit, busy, error };
}

/** Joining a party that asks the host first: say so, rather than spin without a word. */
export function KnockNote() {
  const party = useParty();
  const waiting = !!party?.knocking && party.rules.approve;
  return (
    <p className="party-join-note" role="status" data-shown={waiting}>
      {waiting ? "Waiting for the host to let you in…" : null}
    </p>
  );
}

/** A code field that joins as soon as the code is complete. */
export function JoinForm({ me, onJoined }: { me: Me; onJoined?: () => void }) {
  const { code, change, submit, busy, error } = useJoinParty(me, onJoined);
  return (
    <form
      className="party-join"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        className="party-join-input tabular"
        aria-label="Party code"
        placeholder="Party code"
        autoComplete="off"
        spellCheck={false}
        maxLength={CODE_LENGTH + 8} // room for pasted spaces and dashes
        value={code}
        data-invalid={!!error}
        onChange={(e) => change(e.target.value)}
      />
      <Button variant="glass" className="party-join-btn" type="submit" disabled={busy || !code} aria-busy={busy}>
        <BusyLabel busy={busy}>Join</BusyLabel>
      </Button>
      <p className="party-join-error" role="alert" data-shown={!!error}>
        {error}
      </p>
      <KnockNote />
    </form>
  );
}

/** Who's watching, as a stack of at most three faces and "+N"; a dot for the host when someone waits to join. */
export function PartyFaces({ party }: { party: PartyState }) {
  const shown = party.members.slice(0, 3);
  const extra = party.members.length - shown.length;
  const knocking = party.hostId === party.me && party.knockers.length > 0;
  return (
    <>
      <AnimatePresence initial={false} mode="popLayout">
        {shown.map((m) => (
          <motion.span
            key={m.id}
            layout="position"
            className="party-face"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.14, ease: ease.out } }}
            transition={{ duration: 0.2, ease: ease.out }}
          >
            <Avatar id={m.avatar} />
          </motion.span>
        ))}
      </AnimatePresence>
      {extra > 0 && <span className="party-extra tabular">+{extra}</span>}
      {knocking && <span className="party-knock-dot" aria-hidden />}
    </>
  );
}

/** The faces' accessible name: how many, and whether anyone is waiting to join. */
export function partyBadgeLabel(party: PartyState) {
  const waiting = party.hostId === party.me ? party.knockers.length : 0;
  return `Watch party, ${party.members.length} watching${waiting ? `, ${waiting} waiting to join` : ""}`;
}

/** Player top bar: who's watching. Opens the party panel. */
export function PartyBadge({ party, onOpen }: { party: PartyState; onOpen: () => void }) {
  return (
    <button className="party-badge pressable" onClick={onOpen} aria-label={partyBadgeLabel(party)} title="Watch party" data-status={party.status}>
      <PartyFaces party={party} />
    </button>
  );
}

/**
 * Over the picture: the room waiting on someone, or the connection dropping.
 * Appears only if it lasts (CSS delay), so a blip never flashes it.
 */
export function PartyHold({ party, videoId }: { party: PartyState; videoId: string }) {
  const pb = party.playback;
  // Stalled, if the room pauses for that (#238): as presence says, or sooner as its position report says.
  const stalled = (m: Member) => party.rules.stall && (m.buffering || party.positions[m.id]?.stalled);
  const waiters = party.members.filter((m) => (m.waiting || stalled(m)) && !m.away && m.id !== party.me);
  const text =
    party.error
      ? "Watch party unavailable"
      : party.status === "error"
      ? "Reconnecting to the party…"
      : pb?.held && pb.media.videoId === videoId && waiters.length
        ? `Waiting for ${waiters.length === 1 ? waiters[0].name : `${waiters.length} people`}…`
        : null;
  return (
    <div className="party-hold t-callout" data-shown={!!text} role="status" aria-live="polite">
      <Spinner size={16} />
      <span>{text}</span>
    </div>
  );
}

/** "Sam paused", "Alex joined": brief, bottom-left, newest at the bottom. */
export function PartyNotes({ party }: { party: PartyState }) {
  return (
    <div className="party-notes" aria-live="polite">
      <AnimatePresence initial={false} mode="popLayout">
        {party.notes.map((n) => (
          <motion.div
            key={n.id}
            layout="position"
            className="party-note"
            data-system={n.system || undefined}
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.16, ease: ease.out } }}
            transition={{ duration: 0.24, ease: ease.out }}
          >
            {n.who && <Avatar id={n.who.avatar} />}
            {n.system ? (
              <span>{n.text}</span>
            ) : (
              <span>
                <strong>{n.who?.name ?? "Someone"}</strong> {n.text}
              </span>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
