import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "../ui/Button";
import { useLayer } from "../../lib/ui";
import { api } from "../../lib/api";
import { keys } from "../../lib/net";
import { usePrefs } from "../../lib/settings";
import {
  answerJoinRequest,
  closePartySurface,
  confirmLinkJoin,
  dismissLinkJoin,
  getParty,
  leaveParty,
  openPartySurface,
  refreshJoinDesk,
  runJoinDesk,
  useJoinDesk,
  useLinkJoin,
  useParty,
} from "../../lib/party";

/**
 * Joining a watch party from Discord (#154), both ends, in LinkConfirm's card (TV remotes included):
 * someone asking to join through the button on this user's profile ("Ask me"), and this app joining
 * from a polarity://party link. Each is a party surface while it's up.
 */
export function DiscordJoin() {
  // The desk runs while this party can be joined from Discord: let in, Show on Discord on, Who can join not Nobody.
  const party = useParty();
  const { discordPresence, discordJoin } = usePrefs();
  const { data: discord } = useQuery({ queryKey: keys.discord, queryFn: api.discordAvailable, staleTime: Infinity });
  const code = party && !party.knocking && discord && discordPresence !== "off" ? party.code : null;
  useEffect(() => runJoinDesk(code, discordJoin), [code, discordJoin]);
  useEffect(() => refreshJoinDesk(), [party?.rules.locked]);
  useEffect(() => () => runJoinDesk(null, "nobody"), []);

  const { requests } = useJoinDesk();
  const join = useLinkJoin();
  const request = requests[0];
  const up = !!request || !!join;
  useEffect(() => {
    if (!up) return;
    openPartySurface("discord");
    return () => closePartySurface("discord");
  }, [up]);
  if (request) return <RequestCard key={request.id} name={request.name} more={requests.length - 1} onAnswer={(allow) => answerJoinRequest(request.id, allow)} />;
  if (join?.progress === "confirm") return <ConfirmCard key={join.id} name={join.name ?? ""} />;
  if (join) return <JoinCard key={join.id} progress={join.progress} error={join.error} />;
  return null;
}

function Card({ title, onEscape, children }: { title: string; onEscape: () => void; children: React.ReactNode }) {
  const root = useRef<HTMLDivElement>(null);
  useLayer(root, true, onEscape);
  return (
    <div className="party-link-confirm" role="dialog" aria-modal="true" aria-labelledby="party-discord-title" ref={root} tabIndex={-1} data-layer data-nav-scope>
      <div className="party-link-card">
        <h2 id="party-discord-title" className="t-title2">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

/** "Ask me": the name is what the asker calls themselves in Polarity, so it's said to come from Discord, nothing more. */
function RequestCard({ name, more, onAnswer }: { name: string; more: number; onAnswer: (allow: boolean) => void }) {
  return (
    <Card title={`${name} wants to join`} onEscape={() => onAnswer(false)}>
      <p className="t-callout">
        Asked from the Join watch party button on your Discord profile.
        {more > 0 && ` ${more} more waiting.`}
      </p>
      <div className="player-status-actions">
        <Button variant="glass" onClick={() => onAnswer(false)}>
          Decline
        </Button>
        <Button variant="primary" onClick={() => onAnswer(true)} autoFocus>
          Allow
        </Button>
      </div>
    </Card>
  );
}

/** A link never joins by itself: the user says so first, knowing what the host will see. */
function ConfirmCard({ name }: { name: string }) {
  return (
    <Card title="Join a watch party?" onEscape={dismissLinkJoin}>
      <p className="t-callout">
        A link asks to join someone's watch party. The host sees your profile name, {name}, and decides whether to let you in.
      </p>
      <div className="player-status-actions">
        <Button variant="glass" onClick={dismissLinkJoin}>
          Cancel
        </Button>
        <Button variant="primary" onClick={confirmLinkJoin} autoFocus>
          Ask to Join
        </Button>
      </div>
    </Card>
  );
}

const PROGRESS = {
  asking: "Asking to join…",
  waiting: "Waiting for the host to let you in…",
  joining: "Joining…",
} as const;

function JoinCard({ progress, error }: { progress: keyof typeof PROGRESS | "confirm"; error?: string }) {
  // Closed while joining: that's giving up, also on a room still deciding.
  const cancel = () => {
    if (!error && progress === "joining" && getParty()?.knocking) leaveParty();
    dismissLinkJoin();
  };
  return (
    <Card title={error ? "Couldn't join the watch party" : "Joining a Watch Party"} onEscape={cancel}>
      <p className="t-callout" role="status" data-testid="party-discord-status">
        {error ?? PROGRESS[progress === "confirm" ? "asking" : progress]}
      </p>
      <div className="player-status-actions">
        <Button variant={error ? "primary" : "glass"} onClick={cancel} autoFocus>
          {error ? "OK" : "Cancel"}
        </Button>
      </div>
    </Card>
  );
}
