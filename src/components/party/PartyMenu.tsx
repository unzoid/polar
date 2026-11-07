import { useEffect, useState, type ReactNode } from "react";
import { endParty, expectedPosition, leaveParty, partyLog, setQuiet, setRules, syncNow, type PartyState } from "../../lib/party";
import { formatTime } from "../../lib/format";
import { useMeta } from "../../lib/net";
import { osName } from "../../lib/platform";
import { useRouter } from "../../lib/router";
import { appVersion } from "../../lib/updater";
import { Lock, Pause, Play } from "../icons";
import { Button } from "../ui/Button";
import { Switch } from "../ui/Switch";
import { PartyInvite, PartyMembers } from "./PartyUI";

/**
 * The party menu (#156): what's on, who's here, the code, and what you can
 * do from anywhere in the app. The top bar's party faces open it as a
 * popover, TV mode as a panel; the player's Watch Party panel shows the same
 * parts in two columns (PartyRoomPane, PartySettingsPane).
 */
export function PartyMenu({ party, onClose }: { party: PartyState; onClose?: () => void }) {
  const host = party.hostId === party.me;
  return (
    <div className="party-menu">
      <PartyNowPlaying party={party} />
      <PartyStreamButtons party={party} onGo={onClose} />
      <section className="party-menu-section" aria-label="Members">
        <PartyMembers party={party} />
      </section>
      <section className="party-menu-section">
        <PartyInvite party={party} leave={false} />
      </section>
      <section className="party-menu-section">
        <PartyQuiet party={party} />
        <div className="party-buttons">
          <Button variant="glass" onClick={leaveParty}>
            Leave Party
          </Button>
          <PartyCopyLog />
        </div>
      </section>
      {host && (
        <section className="party-menu-section">
          <h3 className="party-kicker">Host controls</h3>
          <PartyRules party={party} />
          <PartyEnd />
        </section>
      )}
    </div>
  );
}

/**
 * The Watch Party panel's left column (the player's, and TV mode's with `now`):
 * what's on, the code to share, who's here, and getting back in step or out.
 * Sections stacked, a hairline between.
 */
export function PartyRoomPane({ party, onGo, now, autoFocus }: { party: PartyState; onGo?: () => void; now?: boolean; autoFocus?: boolean }) {
  return (
    <div className="party-column">
      {now && party.playback?.media && (
        <section>
          <PartyNowPlaying party={party} />
        </section>
      )}
      <section>
        <PartyInvite party={party} leave={false} autoFocus={autoFocus} />
      </section>
      <section aria-label="Members">
        <h3 className="party-kicker">Watching · {party.members.length}</h3>
        <PartyMembers party={party} />
      </section>
      <section>
        <div className="party-buttons">
          <PartyStreamButtons party={party} onGo={onGo} />
          <Button variant="glass" onClick={leaveParty}>
            Leave Party
          </Button>
        </div>
      </section>
    </div>
  );
}

/**
 * The player's Watch Party panel, right column: every switch in one list (the
 * host's rules under the sound one), putting a link on, and the rarer actions last.
 */
export function PartySettingsPane({ party, link }: { party: PartyState; link?: ReactNode }) {
  const host = party.hostId === party.me;
  return (
    <div className="party-column">
      <section>
        <PartyQuiet party={party} />
        {host && <PartyRules party={party} />}
      </section>
      {link && (
        <section>
          <h3 className="party-kicker">Watch a link</h3>
          <p className="party-lede">Put a video file or stream from the web on for everyone. Everyone's app opens the link itself, after seeing it.</p>
          {link}
        </section>
      )}
      <section>
        <div className="party-buttons">
          <PartyCopyLog />
          {host && <PartyEnd />}
        </div>
      </section>
    </div>
  );
}

/** "S1:E3 · Title" as "S1 E3 · Title". */
const episodeLabel = (label?: string) => label?.replace(/\bS(\d+):E(\d+)\b/, "S$1 E$2");

/** The room's position, ticking while it plays. */
function useRoomPosition(party: PartyState) {
  const pb = party.playback;
  const [, tick] = useState(0);
  const running = !!pb && !pb.paused && !pb.held;
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, [running]);
  return pb ? expectedPosition(pb) : 0;
}

/** What the room is on: poster, title, episode, where, and whether it's playing. */
export function PartyNowPlaying({ party }: { party: PartyState }) {
  const media = party.playback?.media;
  const { data: meta } = useMeta(media?.type ?? "movie", media?.metaId ?? "", !!media);
  const position = useRoomPosition(party);
  if (!media || !party.playback) return null;
  const paused = party.playback.paused || party.playback.held;
  const label = episodeLabel(media.label);
  const title = meta?.name ?? label ?? "Something";
  return (
    <div className="party-now">
      <div className="party-now-poster" aria-hidden>
        {meta?.poster && <img src={meta.poster} alt="" draggable={false} />}
      </div>
      <div className="party-now-text">
        <span className="party-kicker">Now playing</span>
        <span className="party-now-title">{title}</span>
        {label && meta?.name && media.type === "series" && <span className="party-now-detail">{label}</span>}
        <span className="party-now-detail tabular">
          {paused ? <Pause size={12} /> : <Play size={12} fill="currentColor" />}
          {paused ? "Paused" : "Playing"} · {formatTime(position)}
        </span>
      </div>
    </div>
  );
}

/** Back to the room's video from anywhere, or back in step in the player. */
export function PartyStreamButtons({ party, onGo }: { party: PartyState; onGo?: () => void }) {
  const { current, navigate, replace } = useRouter();
  const media = party.playback?.media;
  if (!media) return null;
  const onRoomVideo = current.name === "player" && current.videoId === media.videoId;
  const go = () => {
    const route = { name: "player", type: media.type, metaId: media.metaId, videoId: media.videoId } as const;
    if (current.name === "player") replace(route);
    else navigate(route);
    onGo?.();
  };
  return (
    <div className="party-buttons party-stream">
      {onRoomVideo ? (
        <Button variant="glass" onClick={syncNow}>
          Sync Now
        </Button>
      ) : (
        <Button variant="primary" onClick={go}>
          <Play size={16} fill="currentColor" /> Go to the Current Stream
        </Button>
      )}
    </div>
  );
}

/** Mute the room's chimes and join/leave notes. */
export function PartyQuiet({ party }: { party: PartyState }) {
  return (
    <label className="party-switch">
      <span className="party-switch-text">
        <span>Mute party sounds</span>
        <span className="party-switch-caption">No chimes or join and leave notices</span>
      </span>
      <Switch checked={party.quiet} onChange={setQuiet} />
    </label>
  );
}

/**
 * Copies this device's party log (#203), to compare a session that went wrong
 * from both ends. Nothing personal in it: see lib/party/log.ts.
 */
export function PartyCopyLog() {
  const [copied, setCopied] = useState<"yes" | "no" | null>(null);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(null), 2500);
    return () => window.clearTimeout(t);
  }, [copied]);
  const copy = async () => {
    const app = await appVersion().catch(() => "unknown");
    navigator.clipboard.writeText(partyLog([`App ${app} on ${osName}`])).then(
      () => setCopied("yes"),
      () => setCopied("no"),
    );
  };
  return (
    <Button variant="glass" onClick={() => void copy()}>
      {copied === "yes" ? "Copied" : copied === "no" ? "Couldn't copy" : "Copy Party Log"}
    </Button>
  );
}

/** Ending the party for everyone, asked twice. */
export function PartyEnd() {
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    if (!confirm) return;
    const t = window.setTimeout(() => setConfirm(false), 4000);
    return () => window.clearTimeout(t);
  }, [confirm]);
  return (
    <Button variant="glass" className="party-end" onClick={() => (confirm ? endParty() : setConfirm(true))} aria-live="polite">
      {confirm ? "End for Everyone?" : "End Party"}
    </Button>
  );
}

/** The host's switches: who can join and who controls playback. */
export function PartyRules({ party }: { party: PartyState }) {
  const { rules } = party;
  const rows: { label: string; caption: string; checked: boolean; set: (on: boolean) => void }[] = [
    {
      label: "Lock party",
      caption: "No new joins: the code stops working until you unlock it",
      checked: rules.locked,
      set: (locked) => setRules({ locked }),
    },
    {
      label: "Approve joins",
      caption: "New people wait until you let them in",
      checked: rules.approve,
      set: (approve) => setRules({ approve }),
    },
    {
      label: "Only I control playback",
      caption: "Play, pause, seeking and changing episodes",
      checked: rules.control === "host",
      set: (on) => setRules({ control: on ? "host" : "everyone" }),
    },
    {
      label: "Wait for everyone",
      caption: "Hold playback while someone is loading",
      checked: rules.wait,
      set: (wait) => setRules({ wait }),
    },
    {
      label: "Pause when someone is buffering",
      caption: "Hold playback while someone's video stalls",
      checked: rules.stall,
      set: (stall) => setRules({ stall }),
    },
  ];
  return (
    <>
      {rows.map((r) => (
        <label key={r.label} className="party-switch">
          <span className="party-switch-text">
            <span>
              {r.label === "Lock party" && r.checked && <Lock size={14} />} {r.label}
            </span>
            <span className="party-switch-caption">{r.caption}</span>
          </span>
          <Switch checked={r.checked} onChange={r.set} />
        </label>
      ))}
    </>
  );
}
