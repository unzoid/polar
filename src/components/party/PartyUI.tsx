import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { ease } from "../../lib/motion";
import {
  CODE_LENGTH,
  joinParty,
  leaveParty,
  normalizeCode,
  type Member,
  type PartyState,
} from "../../lib/party/party";
import { Avatar } from "../Avatar";
import { BusyLabel } from "../BusyLabel";
import { Spinner } from "../Spinner";
import { Check, Users } from "../icons";

type Me = Pick<Member, "name" | "avatar">;

/** Not in a party: start one on what's playing, or join a friend's. */
export function PartyStart({ onStart, me }: { onStart: () => void; me: Me }) {
  return (
    <div className="party-pane">
      <p className="party-lede">
        Watch in sync with friends. Everyone plays from their own sources; pausing, seeking and changing episodes happen
        for the whole room.
      </p>
      <button className="btn btn-primary party-start" onClick={onStart}>
        <Users size={18} /> Start a Watch Party
      </button>
      <div className="party-or" aria-hidden>
        <span>or join one</span>
      </div>
      <JoinForm me={me} />
    </div>
  );
}

/** In a party: the code to share, and leaving. */
export function PartyInvite({ party }: { party: PartyState }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const copy = () => {
    void navigator.clipboard.writeText(`Watch with me on Polarity. Party code: ${party.code}`).then(() => {
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
        <button className="btn btn-primary party-copy" onClick={copy} data-copied={copied}>
          <span className="party-copy-label" data-shown={!copied}>
            Copy Invite
          </span>
          <span className="party-copy-label" data-shown={copied} aria-hidden={!copied}>
            <Check size={16} /> Copied
          </span>
        </button>
        <button className="btn btn-glass" onClick={leaveParty}>
          Leave Party
        </button>
      </div>
    </div>
  );
}

/** Who's here, and who the room is waiting on. */
export function PartyMembers({ party }: { party: PartyState }) {
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
              <span className="party-member-detail">
                {m.waiting ? "Loading…" : m.id === party.hostId ? "Host" : "Watching"}
              </span>
            </span>
            {m.waiting && <Spinner size={16} label="Loading" />}
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

/** A code field that joins as soon as the code is complete. */
export function JoinForm({ me, onJoined }: { me: Me; onJoined?: () => void }) {
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = (value: string) => {
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
  return (
    <form
      className="party-join"
      onSubmit={(e) => {
        e.preventDefault();
        submit(code);
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
        onChange={(e) => {
          const v = normalizeCode(e.target.value);
          setCode(v);
          setError(null);
          // Typed or pasted in full: no need to press anything.
          if (v.length === CODE_LENGTH && v !== code) submit(v);
        }}
      />
      <button className="btn btn-glass party-join-btn" type="submit" disabled={busy || !code} aria-busy={busy}>
        <BusyLabel busy={busy}>Join</BusyLabel>
      </button>
      <p className="party-join-error" role="alert" data-shown={!!error}>
        {error}
      </p>
    </form>
  );
}

/** Top bar: who's watching, as a stack of faces. Opens the party panel. */
export function PartyBadge({ party, onOpen }: { party: PartyState; onOpen: () => void }) {
  const shown = party.members.slice(0, 3);
  const extra = party.members.length - shown.length;
  return (
    <button
      className="party-badge pressable"
      onClick={onOpen}
      aria-label={`Watch party, ${party.members.length} watching`}
      title="Watch party"
      data-status={party.status}
    >
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
    </button>
  );
}

/**
 * Over the picture: the room waiting on someone, or the connection dropping.
 * Appears only if it lasts (CSS delay), so a blip never flashes it.
 */
export function PartyHold({ party, videoId }: { party: PartyState; videoId: string }) {
  const pb = party.playback;
  const waiters = party.members.filter((m) => m.waiting && m.id !== party.me);
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
            initial={{ opacity: 0, y: 8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.16, ease: ease.out } }}
            transition={{ duration: 0.24, ease: ease.out }}
          >
            {n.who && <Avatar id={n.who.avatar} />}
            <span>
              <strong>{n.who?.name ?? "Someone"}</strong> {n.text}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
